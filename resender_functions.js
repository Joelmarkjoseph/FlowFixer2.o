/* Resender Functions - Fetch failed messages and payloads from OData API */

// ============ HTTP HELPER FUNCTIONS ============

function httpWithAuth(method, url, username, password, body, accept) {
  return new Promise((resolve, reject) => {
    // Check if this is a cross-origin request
    const absoluteUrl = url.startsWith('http') ? url : (location.protocol + '//' + location.host + url);
    const isCrossOrigin = absoluteUrl.startsWith('http') && !absoluteUrl.includes(window.location.host);
    
    console.log('httpWithAuth called:', {
      url,
      absoluteUrl,
      currentHost: window.location.host,
      isCrossOrigin
    });
    
    if (isCrossOrigin) {
      // Use background script for cross-origin requests to bypass CORS
      console.log('Using background script for cross-origin request to:', absoluteUrl);
      
      // Check if extension context is valid
      if (!chrome.runtime?.id) {
        reject(new Error('Extension context invalidated. Please reload the page.'));
        return;
      }
      
      chrome.runtime.sendMessage({
        type: 'CROSS_ORIGIN_REQUEST',
        method: method,
        url: absoluteUrl,
        username: username,
        password: password,
        body: body,
        accept: accept
      }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message;
          if (errorMsg.includes('Extension context invalidated')) {
            reject(new Error('Extension context invalidated. Please reload the page.'));
          } else {
            reject(new Error('Extension communication error: ' + errorMsg));
          }
          return;
        }
        
        if (response && response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response ? response.error : 'No response from background script'));
        }
      });
    } else {
      // Use XHR for same-origin requests
      const xhr = new XMLHttpRequest();
      xhr.withCredentials = true;
      
      console.log('httpWithAuth making same-origin request to:', absoluteUrl);
      xhr.open(method, absoluteUrl);
      
      // Set headers
      if (method === 'POST' && body) {
        // For POST requests with body, use accept parameter as Content-Type
        xhr.setRequestHeader('Content-Type', accept || 'application/xml');
      } else if (accept) {
        // For GET requests, use accept parameter as Accept header
        xhr.setRequestHeader('Accept', accept);
      }
      
      // Always set Authorization header
      if (username && password) {
        const credentials = btoa(username + ':' + password);
        xhr.setRequestHeader('Authorization', 'Basic ' + credentials);
      }
      
      xhr.onload = () => {
        console.log('httpWithAuth response status:', xhr.status, 'for URL:', absoluteUrl);
        if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.responseText);
        let errorMsg = method + " " + absoluteUrl + " status " + xhr.status;
        if (xhr.statusText) errorMsg += " - " + xhr.statusText;
        if (xhr.status === 404) errorMsg += ". URL might be incorrect or endpoint doesn't exist.";
        if (xhr.status === 401 || xhr.status === 403) errorMsg += ". Check username and password.";
        reject(new Error(errorMsg));
      };
      
      xhr.onerror = (e) => {
        console.error('XHR error:', e, 'URL:', absoluteUrl);
        reject(new Error("network error"));
      };
      
      xhr.send(body || null);
    }
  });
}

// ============ PARSE ODATA RESPONSES ============

function parseMessageProcessingLogs(jsonText) {
  try {
    const json = JSON.parse(jsonText);
    const results = json.value || json.d?.results || [];
    
    return results.map(msg => ({
      messageGuid: msg.MessageGuid || '',
      correlationId: msg.CorrelationId || '',
      applicationMessageId: msg.ApplicationMessageId || '',
      integrationFlowName: msg.IntegrationFlowName || '',
      status: msg.Status || '',
      logStart: msg.LogStart || null,
      logEnd: msg.LogEnd || null,
      sender: msg.Sender || '',
      receiver: msg.Receiver || '',
      customStatus: msg.CustomStatus || '',
      transactionId: msg.TransactionId || '',
      integrationArtifact: msg.IntegrationArtifact || {}
    }));
  } catch (error) {
    console.error('Error parsing message processing logs:', error);
    return [];
  }
}

function parseAttachments(jsonText) {
  try {
    const json = JSON.parse(jsonText);
    const results = json.value || json.d?.results || [];
    
    return results.map(att => ({
      id: att.Id || att.ID || '',
      name: att.Name || att.name || 'payload',
      contentType: att.ContentType || att.contentType || 'application/xml',
      messageGuid: att.MessageGuid || att.messageGuid || ''
    }));
  } catch (error) {
    console.error('Error parsing attachments:', error);
    return [];
  }
}

// ============ FETCH FAILED MESSAGES WITH PAYLOADS ============

async function fetchFailedMessagesFromOData(baseUrl, username, password, startDate) {
  try {
    // Format date for OData filter
    const dateStr = startDate ? new Date(startDate).toISOString().replace(/\.\d{3}Z$/, '.000') : 
                    new Date(Date.now() - 24*60*60*1000).toISOString().replace(/\.\d{3}Z$/, '.000');
    
    const select = '$select=MessageGuid,CorrelationId,ApplicationMessageId,PredecessorMessageGuid,ApplicationMessageType,LogStart,LogEnd,Sender,Receiver,IntegrationFlowName,Status,AlternateWebLink,LogLevel,CustomStatus,ArchivingStatus,ArchivingSenderChannelMessages,ArchivingReceiverChannelMessages,ArchivingLogAttachments,ArchivingPersistedMessages,TransactionId,PreviousComponentName,LocalComponentName,OriginComponentName,IntegrationArtifact';
    const filter = `$filter=Status eq 'FAILED' and LogStart ge datetime'${dateStr}'`;
    const orderby = '$orderby=LogStart';
    
    const url = `${baseUrl}/api/v1/MessageProcessingLogs?${select}&${filter}&${orderby}&$format=json`;
    
    console.log('Fetching failed messages from:', url);
    
    const response = await httpWithAuth('GET', url, username, password, null, 'application/json');
    const messages = parseMessageProcessingLogs(response);
    
    console.log(`Found ${messages.length} failed messages`);
    return messages;
    
  } catch (error) {
    console.error('Error fetching failed messages:', error);
    throw new Error('Failed to fetch message processing logs: ' + error.message);
  }
}

async function fetchMessageAttachments(baseUrl, messageGuid, username, password) {
  try {
    const url = `${baseUrl}/api/v1/MessageProcessingLogs('${messageGuid}')/Attachments?$format=json`;
    
    console.log('Fetching attachments for message:', messageGuid);
    
    const response = await httpWithAuth('GET', url, username, password, null, 'application/json');
    const attachments = parseAttachments(response);
    
    console.log(`Found ${attachments.length} attachments for message ${messageGuid}`);
    return attachments;
    
  } catch (error) {
    console.error('Error fetching attachments for message', messageGuid, ':', error);
    return [];
  }
}

async function fetchAttachmentPayload(baseUrl, attachmentId, username, password) {
  try {
    const url = `${baseUrl}/api/v1/MessageProcessingLogAttachments('${attachmentId}')/$value`;
    
    console.log('Fetching payload for attachment:', attachmentId);
    
    const payload = await httpWithAuth('GET', url, username, password, null, 'application/octet-stream');
    
    console.log(`Fetched payload for attachment ${attachmentId}, length:`, payload?.length || 0);
    return payload;
    
  } catch (error) {
    console.error('Error fetching payload for attachment', attachmentId, ':', error);
    return null;
  }
}

async function fetchFailedMessagesWithPayloads(baseUrl, username, password, startDate, progressCallback) {
  try {
    // Step 1: Get all failed messages
    if (progressCallback) progressCallback('Fetching failed messages...');
    const messages = await fetchFailedMessagesFromOData(baseUrl, username, password, startDate);
    
    if (messages.length === 0) {
      if (progressCallback) progressCallback('No failed messages found');
      return [];
    }
    
    // Step 2: For each message, fetch attachments and payloads
    const messagesWithPayloads = [];
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      if (progressCallback) {
        progressCallback(`Processing message ${i + 1}/${messages.length}: ${msg.messageGuid.substring(0, 8)}...`);
      }
      
      try {
        // Fetch attachments for this message
        const attachments = await fetchMessageAttachments(baseUrl, msg.messageGuid, username, password);
        
        // Fetch payload for each attachment
        const attachmentsWithPayloads = [];
        for (const att of attachments) {
          const payload = await fetchAttachmentPayload(baseUrl, att.id, username, password);
          attachmentsWithPayloads.push({
            ...att,
            payload: payload
          });
        }
        
        messagesWithPayloads.push({
          ...msg,
          attachments: attachmentsWithPayloads,
          // Use first attachment payload as main payload
          payload: attachmentsWithPayloads.length > 0 ? attachmentsWithPayloads[0].payload : null
        });
        
      } catch (msgError) {
        console.error('Error processing message', msg.messageGuid, ':', msgError);
        // Add message without payload
        messagesWithPayloads.push({
          ...msg,
          attachments: [],
          payload: null,
          error: msgError.message
        });
      }
    }
    
    if (progressCallback) {
      progressCallback(`Successfully processed ${messagesWithPayloads.length} messages`);
    }
    
    console.log(`Successfully processed ${messagesWithPayloads.length} messages with payloads`);
    return messagesWithPayloads;
    
  } catch (error) {
    console.error('Error in fetchFailedMessagesWithPayloads:', error);
    throw error;
  }
}

// ============ FETCH IFLOW ENDPOINTS ============

async function fetchIflowEndpoint(baseUrl, iflowName, username, password) {
  try {
    const filter = `Name eq '${iflowName.replace(/'/g, "''")}'`;
    const url = `${baseUrl}/api/v1/IntegrationRuntimeArtifacts?$filter=${encodeURIComponent(filter)}&$expand=EntryPoints&$format=json`;
    
    console.log('Fetching endpoint for iFlow:', iflowName);
    const response = await httpWithAuth('GET', url, username, password, null, 'application/json');
    
    const json = JSON.parse(response);
    const artifacts = json.value || json.d?.results || [];
    
    if (artifacts.length === 0) {
      throw new Error(`No endpoint found for iFlow: ${iflowName}`);
    }
    
    const artifact = artifacts[0];
    const entryPoints = artifact.EntryPoints || artifact.entryPoints || [];
    
    if (entryPoints.length === 0) {
      throw new Error(`No entry points found for iFlow: ${iflowName}`);
    }
    
    // Return the first HTTP entry point
    const httpEntry = entryPoints.find(ep => 
      (ep.Type || ep.type || '').toLowerCase().includes('http')
    ) || entryPoints[0];
    
    return {
      url: httpEntry.Url || httpEntry.url,
      type: httpEntry.Type || httpEntry.type,
      name: httpEntry.Name || httpEntry.name
    };
  } catch (error) {
    console.error('Failed to fetch endpoint for', iflowName, error);
    throw error;
  }
}

// ============ RESEND MESSAGE ============

async function resendMessage(endpoint, payload, username, password, contentType = 'application/xml') {
  try {
    console.log('Resending message to:', endpoint);
    console.log('Payload length:', payload ? payload.length : 0);
    console.log('Content-Type:', contentType);
    
    const response = await httpWithAuth('POST', endpoint, username, password, payload, contentType);
    
    console.log('Message resent successfully, response:', response);
    return { success: true, response };
  } catch (error) {
    console.error('Failed to resend message:', error);
    return { success: false, error: error.message };
  }
}

// ============ BATCH RESEND ============

async function resendSelectedMessages(selectedMessages, iflowSymbolicName, username, password, statusCallback) {
  try {
    if (!selectedMessages || selectedMessages.length === 0) {
      throw new Error('No messages selected');
    }
    
    // Get saved payloads from storage
    const allPayloads = await getAllSavedPayloads();
    const savedPayloads = allPayloads[iflowSymbolicName] || [];
    
    if (savedPayloads.length === 0) {
      throw new Error('No saved payloads found. Please fetch payloads first.');
    }
    
    // Determine base URL
    let baseUrl;
    const isNEO = location.href.includes('/itspaces/');
    
    if (isNEO) {
      baseUrl = window.location.protocol + '//' + window.location.host;
    } else {
      const savedData = await safeStorageGet(['resenderApiUrl']);
      baseUrl = savedData.resenderApiUrl;
      
      if (!baseUrl) {
        throw new Error('API URL is required for Cloud Foundry environment');
      }
      
      baseUrl = baseUrl.replace(/\/$/, '');
    }
    
    // Determine credentials for API calls
    let apiUsername = username;
    let apiPassword = password;
    
    if (!isNEO) {
      const savedData = await safeStorageGet(['resenderClientId', 'resenderClientSecret']);
      if (savedData.resenderClientId && savedData.resenderClientSecret) {
        apiUsername = savedData.resenderClientId;
        apiPassword = savedData.resenderClientSecret;
        console.log('Using Client ID/Secret for resending');
      }
    }
    
    if (statusCallback) statusCallback(`Fetching iFlow endpoint for ${iflowSymbolicName}...`);
    
    // Fetch iFlow endpoint
    const endpoint = await fetchIflowEndpoint(baseUrl, iflowSymbolicName, apiUsername, apiPassword);
    console.log('iFlow endpoint:', endpoint);
    
    // Resend each selected message
    const results = [];
    
    for (let i = 0; i < selectedMessages.length; i++) {
      const selectedMsg = selectedMessages[i];
      const messageId = selectedMsg.messageId;
      
      if (statusCallback) {
        statusCallback(`Resending ${i + 1}/${selectedMessages.length}: ${messageId.substring(0, 8)}...`);
      }
      
      // Find the saved payload
      const savedMsg = savedPayloads.find(p => p.messageGuid === messageId);
      
      if (!savedMsg || !savedMsg.payload) {
        results.push({
          messageGuid: messageId,
          integrationFlowName: iflowSymbolicName,
          success: false,
          error: 'No payload found'
        });
        continue;
      }
      
      try {
        // Determine content type from attachment info
        const contentType = savedMsg.attachments && savedMsg.attachments.length > 0 
          ? (savedMsg.attachments[0].contentType || 'application/xml')
          : 'application/xml';
        
        // Resend the message
        const result = await resendMessage(endpoint.url, savedMsg.payload, apiUsername, apiPassword, contentType);
        
        results.push({
          messageGuid: messageId,
          integrationFlowName: iflowSymbolicName,
          ...result
        });
        
      } catch (error) {
        results.push({
          messageGuid: messageId,
          integrationFlowName: iflowSymbolicName,
          success: false,
          error: error.message
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    if (statusCallback) {
      statusCallback(`Completed: ${successCount}/${selectedMessages.length} messages resent successfully`);
    }
    
    return {
      success: true,
      results,
      successCount,
      totalCount: selectedMessages.length
    };
    
  } catch (error) {
    console.error('Error in resendSelectedMessages:', error);
    if (statusCallback) statusCallback(`Error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============ STORAGE HELPER FUNCTIONS ============

async function safeStorageGet(keys) {
  try {
    if (!chrome.runtime?.id) {
      throw new Error('Extension context invalidated');
    }
    
    return await new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  } catch (error) {
    console.log('Storage operation failed:', error.message);
    return {};
  }
}

async function getAllSavedPayloads() {
  try {
    const result = await safeStorageGet(['resenderPayloads']);
    return result.resenderPayloads || {};
  } catch (error) {
    console.error('Error getting saved payloads:', error);
    return {};
  }
}
