/* CPI Helper Lite content script */
(function(){
  const state = {
    urlExtension: "",
    tenant: location.host,
    runtimeLocations: [],
    currentPlatform: /cfapps/.test(location.host) ? "cf" : "neo",
    cachedRows: [],
    pageIndex: 0,
    batchSize: 25,
    resenderMessages: [],
  };

  function absolutePath(href){
    const a = document.createElement('a');
    a.href = href;
    return a.protocol + '//' + a.host + a.pathname + a.search + a.hash;
  }

  function getBaseUrl(){
    return location.protocol + '//' + location.host;
  }

  function httpWithAuth(method, url, username, password, body, accept){
    return new Promise((resolve, reject)=>{
      // Check if this is a cross-origin request
      const finalUrl = url.startsWith('http') ? url : absolutePath(url);
      const isCrossOrigin = finalUrl.startsWith('http') && !finalUrl.includes(window.location.host);
      
      console.log('httpWithAuth called:', {
        url,
        finalUrl,
        currentHost: window.location.host,
        isCrossOrigin,
        includes: finalUrl.includes(window.location.host)
      });
      
      if (isCrossOrigin) {
        // Use background script for cross-origin requests to bypass CORS
        console.log('Using background script for cross-origin request to:', finalUrl);
        
        // Check if extension context is valid
        if (!chrome.runtime?.id) {
          reject(new Error('Extension context invalidated. Please reload the page.'));
          return;
        }
        
        chrome.runtime.sendMessage({
          type: 'CROSS_ORIGIN_REQUEST',
          method: method,
          url: finalUrl,
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
        
        console.log('httpWithAuth making same-origin request to:', finalUrl);
        xhr.open(method, finalUrl);
        
        // Set headers
        if (method === 'POST' && body) {
          // For POST requests with body, use accept parameter as Content-Type
          xhr.setRequestHeader('Content-Type', accept || 'application/xml');
        } else if (accept) {
          // For GET requests, use accept parameter as Accept header
          xhr.setRequestHeader('Accept', accept);
        }
        
        // Always set Authorization header for resender requests
        if (username && password){
          const credentials = btoa(username + ':' + password);
          xhr.setRequestHeader('Authorization', 'Basic ' + credentials);
        }
        
        xhr.onload = ()=>{
          console.log('httpWithAuth response status:', xhr.status, 'for URL:', finalUrl);
          if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.responseText);
          let errorMsg = method+" "+finalUrl+" status "+xhr.status;
          if (xhr.statusText) errorMsg += " - " + xhr.statusText;
          if (xhr.status === 404) errorMsg += ". URL might be incorrect or endpoint doesn't exist.";
          if (xhr.status === 401 || xhr.status === 403) errorMsg += ". Check username and password.";
          reject(new Error(errorMsg));
        };
        
        xhr.onerror = (e)=>{
          console.error('XHR error:', e, 'URL:', finalUrl);
          reject(new Error("network error"));
        };
        
        xhr.send(body || null);
      }
    });
  }

  // detect classic itspaces prefix for NEO
  function computeUrlExtension(){
    const isCF = /integrationsuite(-trial)?/.test(location.host);
    return isCF ? "" : "itspaces/";
  }

  async function http(method, url, accept, username, password){
    return new Promise((resolve, reject)=>{
      const xhr = new XMLHttpRequest();
      xhr.withCredentials = true;
      xhr.open(method, absolutePath(url));
      if (accept) xhr.setRequestHeader('Accept', accept);
      if (username && password){
        const credentials = btoa(username + ':' + password);
        xhr.setRequestHeader('Authorization', 'Basic ' + credentials);
      }
      xhr.onload = ()=>{
        if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.responseText);
        reject(new Error(method+" "+url+" status "+xhr.status));
      };
      xhr.onerror = ()=>reject(new Error("network error"));
      xhr.send();
    });
  }

  async function listAllIflowsCF(){
    // 1) Runtime locations
    const runtimeXml = await http('GET', '/'+state.urlExtension+'Operations/com.sap.it.op.srv.web.cf.RuntimeLocationListCommand');
    const runtimeJson = new XmlToJson().parse(runtimeXml)['com.sap.it.op.srv.web.cf.RuntimeLocationListResponse'];
    const locations = Array.isArray(runtimeJson.runtimeLocations) ? runtimeJson.runtimeLocations : [runtimeJson.runtimeLocations];
    state.runtimeLocations = locations.filter(l=>String(l.state).toUpperCase()==='ACTIVE');

    // 2) For each location, list Integration Components and aggregate artifacts
    const seen = new Map();
    for (const loc of state.runtimeLocations){
      const respXml = await http('GET', '/'+state.urlExtension+'Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListCommand?runtimeLocationId='+encodeURIComponent(loc.id));
      const parsed = new XmlToJson().parse(respXml)['com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListResponse'];
      const list = Array.isArray(parsed.artifactInformations) ? parsed.artifactInformations : (parsed.artifactInformations ? [parsed.artifactInformations] : []);
      for (const a of list){
        if (!a || !a.symbolicName) continue;
        if (!seen.has(a.symbolicName)){
          seen.set(a.symbolicName, { id: a.id, name: a.name, symbolicName: a.symbolicName });
        }
      }
    }
    return Array.from(seen.values());
  }

  async function listAllIflowsNEO(){
    const respXml = await http('GET', '/'+state.urlExtension+'Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListCommand');
    const parsed = new XmlToJson().parse(respXml)['com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListResponse'];
    const list = Array.isArray(parsed.artifactInformations) ? parsed.artifactInformations : (parsed.artifactInformations ? [parsed.artifactInformations] : []);
    return list.map(a=>({ id: a.id, name: a.name, symbolicName: a.symbolicName }));
  }

  async function getCountsForIflow(symbolicName){
    // Count across all available logs
    const to = new Date();
    const from = new Date(to.getTime() - 24*60*60*1000); // kept for potential future narrowing
    const iso = d=>new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().replace('Z','');
    const baseCount = '/'+state.urlExtension+"odata/api/v1/MessageProcessingLogs/$count";
    const common = ` and Status ne 'DISCARDED'`;

    // Escape single quotes for OData literal and URL-encode the entire $filter expression
    const esc = (s)=>String(s).replace(/'/g, "''");
    const filterCompleted = `IntegrationFlowName eq '${esc(symbolicName)}' and Status eq 'COMPLETED'${common}`;
    const filterFailed    = `IntegrationFlowName eq '${esc(symbolicName)}' and Status eq 'FAILED'${common}`;

    const qCompleted = `${baseCount}?$filter=${encodeURIComponent(filterCompleted)}`;
    const qFailed    = `${baseCount}?$filter=${encodeURIComponent(filterFailed)}`;

    const completed = parseInt(await http('GET', qCompleted, 'text/plain'), 10) || 0;
    const failed    = parseInt(await http('GET', qFailed, 'text/plain'), 10) || 0;
    return { completed, failed };
  }

  async function collect(){
    state.urlExtension = computeUrlExtension();
    const iflows = state.currentPlatform === 'cf' ? await listAllIflowsCF() : await listAllIflowsNEO();
    // Parallel counts with small concurrency to avoid hammering
    const results = [];
    const batchSize = 6;
    for (let i=0;i<iflows.length;i+=batchSize){
      const slice = iflows.slice(i,i+batchSize);
      const part = await Promise.all(slice.map(async f=>({
        name: f.name || f.symbolicName,
        symbolicName: f.symbolicName,
        ...(await getCountsForIflow(f.symbolicName))
      })));
      results.push(...part);
    }
    return results;
  }

  async function listFailedMessagesForIflow(symbolicName, top=200){
    const esc = (s)=>String(s).replace(/'/g, "''");
    const filter = `IntegrationFlowName eq '${esc(symbolicName)}' and Status eq 'FAILED'`;
    const baseLogs = '/' + state.urlExtension + 'odata/api/v1/MessageProcessingLogs';
    const logsQs = `?$filter=${encodeURIComponent(filter)}&$orderby=${encodeURIComponent('LogStart desc')}&$top=${encodeURIComponent(String(top))}&$format=json`;

    function normalizeJsonList(txt){
      let json; try{ json = JSON.parse(txt); }catch(_e){ return []; }
      const arr = (json && (json.value || (json.d && json.d.results))) || [];
      const getAny = (obj, names)=>{
        for (const name of names){
          if (!obj) break;
          if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
          const lower = Object.keys(obj).find(k=>k.toLowerCase()===name.toLowerCase());
          if (lower) return obj[lower];
        }
        return undefined;
      };
      return arr.map(x=>({
        messageId: String(getAny(x, ['MessageGuid','MessageID','MessageId','Guid','GUID','MessageGUID']) || ''),
        status: String(getAny(x, ['Status']) || 'FAILED'),
        errorText: String(getAny(x, ['ErrorText','Error','ErrorMessage']) || ''),
        logStart: getAny(x, ['LogStart','TimeStamp']) || null,
        integrationFlowName: String(getAny(x, ['IntegrationFlowName']) || symbolicName)
      }));
    }

    function normalizeXmlList(txt){
      const parsed = new XmlToJson().parse(txt);
      const feed = parsed && parsed.feed;
      const entries = feed && feed.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];
      const list = [];
      for (const en of entries){
        const props = (en && en.content && (en.content["m:properties"] || en.content.properties)) || {};
        const get = (name)=> props[name] ?? props['d:'+name] ?? props['m:'+name];
        list.push({
          messageId: String(get('MessageGuid') || get('MessageID') || get('MessageId') || ''),
          status: String(get('Status') || 'FAILED'),
          errorText: String(get('ErrorText') || get('Error') || ''),
          logStart: get('LogStart') || null,
          integrationFlowName: String(get('IntegrationFlowName') || symbolicName)
        });
      }
      return list;
    }

    // 1) Get the list of failed logs (JSON first, then XML fallback)
    let logs = [];
    try{
      const txt = await http('GET', baseLogs + logsQs, 'application/json');
      logs = normalizeJsonList(txt);
    }catch(_e){ logs = []; }
    if (!Array.isArray(logs) || logs.length === 0){
      const xmlTxt = await http('GET', baseLogs + `?$filter=${encodeURIComponent(filter)}&$orderby=${encodeURIComponent('LogStart desc')}&$top=${encodeURIComponent(String(top))}`, 'application/xml');
      logs = normalizeXmlList(xmlTxt);
    }

    // 2) For each message, fetch detailed error info
    async function fetchErrorDetailsFor(messageId){
      if (!messageId) return '';
      const escId = String(messageId).replace(/'/g, "''");
      const base = '/' + state.urlExtension + 'odata/api/v1/';

      // Helper to decode OData list for both v2/v4 JSON
      const decodeList = (txt)=>{
        try{
          const j = JSON.parse(txt);
          return (j && (j.value || (j.d && j.d.results))) || [];
        }catch(_e){ return []; }
      };

      // Strategy A (DEV-like): Runs -> RunSteps -> collect RunStep.Error
      try{
        const runsTxt = await http('GET', `${base}MessageProcessingLogs('${encodeURIComponent(escId)}')/Runs?$inlinecount=allpages&$format=json&$top=200`, 'application/json');
        const runs = decodeList(runsTxt);
        if (Array.isArray(runs) && runs.length){
          const first = runs[0] || {};
          const overall = first.OverallState || first.Status;
          const runId = (runs.length>1 && overall !== 'COMPLETED' && overall !== 'ESCALATED') ? (runs[1] && runs[1].Id) : (first && first.Id);
          if (runId){
            const stepsTxt = await http('GET', `${base}MessageProcessingLogRuns('${encodeURIComponent(runId)}')/RunSteps?$inlinecount=allpages&$format=json`, 'application/json');
            const steps = decodeList(stepsTxt).filter(s=> s && (s.StepStop != null));
            const errors = steps.map(s=> s.Error || s.LogMessage || '').filter(Boolean);
            if (errors.length) return errors.join(' | ');
          }
        }
      }catch(_e){ /* proceed to strategy B */ }

      // Strategy B: ErrorInformation navigation on the specific log entity
      const candidatesJson = [
        `${base}MessageProcessingLogs('${encodeURIComponent(escId)}')/ErrorInformation?$format=json`,
        `${base}MessageProcessingLogs(MessageGuid='${encodeURIComponent(escId)}')/ErrorInformation?$format=json`
      ];
      for (const url of candidatesJson){
        try{
          const arr = decodeList(await http('GET', url, 'application/json'));
          const details = arr.map(e=> e.ErrorText || e.LongText || e.Message || e.Text || e.LogMessage || '').filter(Boolean).join(' | ');
          if (details) return details;
        }catch(_e){/* try next */}
      }

      // XML fallbacks for both key syntaxes
      const candidatesXml = [
        `${base}MessageProcessingLogs('${encodeURIComponent(escId)}')/ErrorInformation`,
        `${base}MessageProcessingLogs(MessageGuid='${encodeURIComponent(escId)}')/ErrorInformation`
      ];
      for (const url of candidatesXml){
        try{
          const xmlTxt = await http('GET', url, 'application/xml');
          const parsed = new XmlToJson().parse(xmlTxt);
          const feed = parsed && (parsed.feed || parsed['m:feed']);
          const entries = feed && feed.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];
          const list = [];
          for (const en of entries){
            const props = (en && en.content && (en.content["m:properties"] || en.content.properties)) || {};
            const get = (name)=> props[name] ?? props['d:'+name] ?? props['m:'+name];
            list.push(get('ErrorText') || get('LongText') || get('Message') || get('Text') || get('LogMessage') || '');
          }
          const details = list.filter(Boolean).join(' | ');
          if (details) return details;
        }catch(_e){/* try next */}
      }
      return '';
    }

    const results = [];
    const concurrency = 6;
    for (let i=0;i<logs.length;i+=concurrency){
      const slice = logs.slice(i, i+concurrency);
      const part = await Promise.all(slice.map(async m=>({
        messageId: m.messageId,
        status: m.status,
        errorText: m.errorText,
        errorDetails: await fetchErrorDetailsFor(m.messageId),
        logStart: m.logStart,
        integrationFlowName: m.integrationFlowName
      })));
      results.push(...part);
    }
    return results;
  }

  async function getFailedMessageCountsByIflow(){
    try{
      state.urlExtension = computeUrlExtension();
      const iflows = state.currentPlatform === 'cf' ? await listAllIflowsCF() : await listAllIflowsNEO();
      
      // Get failed message counts for each iFlow
      const results = [];
      const batchSize = 6;
      for (let i=0;i<iflows.length;i+=batchSize){
        const slice = iflows.slice(i,i+batchSize);
        const part = await Promise.all(slice.map(async f=>{
          const counts = await getCountsForIflow(f.symbolicName);
          return {
            name: f.name || f.symbolicName,
            symbolicName: f.symbolicName,
            failed: counts.failed || 0
          };
        }));
        results.push(...part);
      }
      
      // Filter to only show iFlows with failed messages
      return results.filter(r => r.failed > 0).sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    }catch(e){
      console.error('Error getting failed message counts:', e);
      throw e;
    }
  }

  async function fetchResenderMessages(url, username, password){
    try{
      let urlToUse = url.trim();
      
      // Validate input
      if (!urlToUse) {
        throw new Error('URL is required');
      }
      
      if (!username || !password){
        throw new Error('Username and password are required for Basic Authentication');
      }
      
      // Remove leading @ if present (user might have copied with @)
      if (urlToUse.startsWith('@')){
        urlToUse = urlToUse.substring(1);
      }
      
      console.log('Fetching resender messages from:', urlToUse);
      console.log('Current location:', window.location.href);
      console.log('Current host:', window.location.host);
      
      // Check if it's a full URL or relative path
      if (urlToUse.startsWith('http://') || urlToUse.startsWith('https://')){
        // Full URL provided - check if it's a SAP domain (covered by manifest permissions)
        const isSAPDomain = urlToUse.includes('.hana.ondemand.com') || 
                           urlToUse.includes('.platform.sapcloud.cn') || 
                           urlToUse.includes('.cfapps.');
        
        if (isSAPDomain) {
          // SAP domain - check if it's the same host as current page
          try{
            const urlObj = new URL(urlToUse);
            const currentHost = window.location.host;
            
            if (urlObj.host === currentHost) {
              // Same host - extract path and use http() function
              const urlPath = urlObj.pathname + urlObj.search + urlObj.hash;
              console.log('Same SAP host detected, using path:', urlPath);
              const xmlText = await http('GET', urlPath, 'application/xml', username, password);
              return parseResenderMessages(xmlText);
            } else {
              // Different SAP subdomain - use httpWithAuth with full URL (will use background script for CORS)
              console.log('Different SAP subdomain detected, using full URL with background script:', urlToUse);
              const xmlText = await httpWithAuth('GET', urlToUse, username, password, null, 'application/xml');
              console.log('Received XML text length:', xmlText ? xmlText.length : 0);
              return parseResenderMessages(xmlText);
            }
          }catch(urlError){
            throw new Error('Invalid URL format: ' + urlError.message);
          }
        } else {
          // Non-SAP domain - use httpWithAuth with full URL
          console.log('Non-SAP domain detected, using full URL with Basic Auth');
          const xmlText = await httpWithAuth('GET', urlToUse, username, password, null, 'application/xml');
          console.log('Received XML text length:', xmlText ? xmlText.length : 0);
          return parseResenderMessages(xmlText);
        }
      } else {
        // Relative path provided - use http() with current origin (same as message overview)
        if (!urlToUse.startsWith('/')){
          urlToUse = '/' + urlToUse;
        }
        console.log('Relative path provided, using current origin:', urlToUse);
        const xmlText = await http('GET', urlToUse, 'application/xml', username, password);
        console.log('Received XML text length:', xmlText ? xmlText.length : 0);
        return parseResenderMessages(xmlText);
      }
    }catch(e){
      const errorMsg = e && e.message || String(e);
      console.error('Resender fetch error:', errorMsg, 'Original URL:', url);
      
      // Provide more specific error messages
      if (errorMsg.includes('network error')) {
        throw new Error('Network error: Unable to connect to the resender endpoint. Please check:\n• URL is correct and accessible\n• Username and password are correct\n• Network connectivity');
      } else if (errorMsg.includes('401') || errorMsg.includes('403')) {
        throw new Error('Authentication failed: Please verify your username and password are correct');
      } else if (errorMsg.includes('404')) {
        throw new Error('Endpoint not found: Please verify the resender URL is correct');
      } else {
        throw new Error('Failed to fetch resender messages: ' + errorMsg);
      }
    }
  }

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

  async function fetchResenderOverview(username, password) {
    try {
      // Step 1: Determine base URL based on environment
      let baseUrl;
      const isNEO = location.href.includes('/itspaces/');
      
      if (isNEO) {
        // NEO: Use current host
        baseUrl = window.location.protocol + '//' + window.location.host;
        console.log('NEO environment detected, using current host:', baseUrl);
      } else {
        // Cloud Foundry: Get API URL from storage
        const savedData = await safeStorageGet(['resenderApiUrl']);
        const apiUrl = savedData.resenderApiUrl;
        
        if (!apiUrl) {
          throw new Error('API URL is required for Cloud Foundry environment. Please configure resender interface first.');
        }
        
        baseUrl = apiUrl.replace(/\/$/, ''); // Remove trailing slash if present
        console.log('Cloud Foundry environment detected, using API URL:', baseUrl);
      }
      
      const serviceEndpointsUrl = baseUrl + "/api/v1/ServiceEndpoints?$select=EntryPoints/Name,EntryPoints/Url&$expand=EntryPoints"; 
      
      console.log('Step 1: Fetching ServiceEndpoints from:', serviceEndpointsUrl);
      
      // Call ServiceEndpoints API - use httpWithAuth to handle cross-origin (CF) and same-origin (NEO)
      const serviceEndpointsXml = await httpWithAuth('GET', serviceEndpointsUrl, username, password, null, 'application/xml');
      console.log('ServiceEndpoints response length:', serviceEndpointsXml ? serviceEndpointsXml.length : 0);
      
      // Step 2: Parse XML to extract the actual resender URL from <d:Url>
      const parsed = new XmlToJson().parse(serviceEndpointsXml);
      console.log('Parsed ServiceEndpoints structure:', parsed);
      
      // Navigate through XML to find <d:Url>
      let resenderUrl = null;
      const findUrl = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj['d:Url']) return obj['d:Url'];
        if (obj['Url']) return obj['Url'];
        for (const key in obj) {
          const result = findUrl(obj[key]);
          if (result) return result;
        }
        return null;
      };
      resenderUrl = findUrl(parsed);
      
      if (!resenderUrl) {
        throw new Error('Could not find resender URL in ServiceEndpoints response');
      }
      
      console.log('Step 2: Extracted resender URL:', resenderUrl);
      
      // Step 3: Call the actual resender URL to get messages
      console.log('Step 3: Fetching messages from resender URL:', resenderUrl);
      
      // Determine credentials for iFlow call
      let iflowUsername = username;
      let iflowPassword = password;
      
      if (!isNEO) {
        // Cloud Foundry: Use Client ID/Secret for iFlow calls
        const savedData = await safeStorageGet(['resenderClientId', 'resenderClientSecret']);
        if (savedData.resenderClientId && savedData.resenderClientSecret) {
          iflowUsername = savedData.resenderClientId;
          iflowPassword = savedData.resenderClientSecret;
          console.log('Cloud Foundry: Using Client ID/Secret for resender iFlow call');
        } else {
          console.warn('Cloud Foundry: Client ID/Secret not found, using username/password');
        }
      }
      
      // Check if it's a cross-origin request
      const resenderUrlObj = new URL(resenderUrl);
      const isCrossOrigin = resenderUrlObj.host !== window.location.host;
      
      let messagesXml;
      if (isCrossOrigin) {
        console.log('Cross-origin detected, using httpWithAuth with credentials');
        console.log('Using Client ID:', iflowUsername ? 'Yes' : 'No');
        console.log('Using Client Secret:', iflowPassword ? 'Yes' : 'No');
        // Use httpWithAuth for cross-origin requests (will use background script)
        messagesXml = await httpWithAuth('GET', resenderUrl, iflowUsername, iflowPassword, null, 'application/xml');
      } else {
        // Same origin, use regular http function
        messagesXml = await http('GET', resenderUrl, 'application/xml', iflowUsername, iflowPassword);
      }
      
      console.log('Received messages XML length:', messagesXml ? messagesXml.length : 0);
      
      // Parse messages
      const messages = parseResenderMessages(messagesXml);
      console.log('Parsed messages:', messages.length, messages);
      
      const iflowSummary = {};
      
      for (const msg of messages) {
        const iflowName = msg.iFlowName || 'Unknown iFlow';
        if (!iflowSummary[iflowName]) {
          iflowSummary[iflowName] = {
            name: iflowName,
            total: 0,
            failed: 0,
            completed: 0,
            messages: []
          };
        }
        
        iflowSummary[iflowName].total++;
        iflowSummary[iflowName].messages.push(msg);
        
        if (msg.status && msg.status.trim().toUpperCase() === 'FAILED') {
          iflowSummary[iflowName].failed++;
        } else {
          iflowSummary[iflowName].completed++;
        }
      }
      
      const result = Object.values(iflowSummary);
      console.log('iFlow summary:', result);
      return result;
    } catch (error) {
      throw error;
    }
  }

  async function fetchMessageProcessingLogs(username, password, apiUrl) {
    try {
      // Determine base URL
      let baseUrl;
      const isNEO = location.href.includes('/itspaces/');
      
      if (isNEO) {
        // NEO: Extract from current page URL
        baseUrl = window.location.protocol + '//' + window.location.host;
      } else {
        // Cloud Foundry: Use provided API URL or extract from current URL
        if (apiUrl) {
          console.log('Using provided API URL:', apiUrl);
          baseUrl = apiUrl.replace(/\/$/, ''); // Remove trailing slash
          // Remove -rt suffix if present in provided URL
          baseUrl = baseUrl.replace(/-rt\./, '.');
        } else {
          // Extract tenant URL from current page and remove -rt suffix if present
          const currentUrl = window.location.href;
          const match = currentUrl.match(/(https?:\/\/[^\/]+)/);
          if (match) {
            console.log('Extracted URL from page:', match[1]);
            baseUrl = match[1];
            // Remove -rt suffix for API calls (runtime URL vs API URL)
            baseUrl = baseUrl.replace(/-rt\./, '.');
            console.log('After removing -rt:', baseUrl);
          } else {
            throw new Error('Could not determine base URL from current page');
          }
        }
      }
      
      console.log('Final Base URL:', baseUrl);
      
      // Calculate time 15 minutes ago
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
      const dateTimeStr = fifteenMinsAgo.toISOString().replace(/\.\d{3}Z$/, '.000');
      
      // Build the MessageProcessingLogs URL
      const select = '$select=MessageGuid,CorrelationId,ApplicationMessageId,PredecessorMessageGuid,ApplicationMessageType,LogStart,LogEnd,Sender,Receiver,IntegrationFlowName,Status,AlternateWebLink,LogLevel,CustomStatus,ArchivingStatus,ArchivingSenderChannelMessages,ArchivingReceiverChannelMessages,ArchivingLogAttachments,ArchivingPersistedMessages,TransactionId,PreviousComponentName,LocalComponentName,OriginComponentName,IntegrationArtifact';
      const filter = `$filter=Status eq 'FAILED' and LogStart ge datetime'${dateTimeStr}'`;
      const orderby = '$orderby=LogStart';
      
      const url = `${baseUrl}/api/v1/MessageProcessingLogs?${select}&${filter}&${orderby}&$format=json`;
      
      console.log('Fetching MessageProcessingLogs from:', url);
      
      // Make the request
      const response = await httpWithAuth('GET', url, username, password, null, 'application/json');
      
      // Parse the response
      const json = JSON.parse(response);
      const logs = json.value || json.d?.results || [];
      
      console.log('=== MESSAGE PROCESSING LOGS ===');
      console.log('Total logs fetched:', logs.length);
      console.log('Logs:', logs);
      console.table(logs);
      console.log('=== END MESSAGE PROCESSING LOGS ===');
      
      // STEP 2: For each message, fetch attachments and payloads
      console.log('\n=== FETCHING ATTACHMENTS AND PAYLOADS ===');
      
      const messagesWithPayloads = [];
      
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        const messageGuid = log.MessageGuid;
        
        console.log(`\n[${i + 1}/${logs.length}] Processing message: ${messageGuid}`);
        
        const messageData = {
          ...log,
          attachments: [],
          payload: null
        };
        
        try {
          // Fetch attachments for this message
          const attachmentsUrl = `${baseUrl}/api/v1/MessageProcessingLogs('${messageGuid}')/Attachments?$format=json`;
          console.log(`  Fetching attachments from: ${attachmentsUrl}`);
          
          const attachmentsResponse = await httpWithAuth('GET', attachmentsUrl, username, password, null, 'application/json');
          const attachmentsJson = JSON.parse(attachmentsResponse);
          const attachments = attachmentsJson.value || attachmentsJson.d?.results || [];
          
          console.log(`  Found ${attachments.length} attachment(s)`);
          
          if (attachments.length > 0) {
            // For each attachment, fetch its payload
            for (let j = 0; j < attachments.length; j++) {
              const attachment = attachments[j];
              const attachmentId = attachment.Id || attachment.ID;
              const attachmentName = attachment.Name || attachment.name || 'unknown';
              
              console.log(`    [Attachment ${j + 1}/${attachments.length}] ID: ${attachmentId}, Name: ${attachmentName}`);
              
              try {
                // Build payload URL - use integrationsuite domain for CF
                let payloadUrl;
                if (isNEO) {
                  payloadUrl = `${baseUrl}/api/v1/MessageProcessingLogAttachments('${attachmentId}')/$value`;
                } else {
                  // For Cloud Foundry, use integrationsuite domain
                  const integrationsuiteUrl = baseUrl.replace(/\.it-cpi[^.]*\./, '.integrationsuite-trial.');
                  payloadUrl = `${integrationsuiteUrl}/api/v1/MessageProcessingLogAttachments('${attachmentId}')/$value`;
                }
                
                console.log(`      Fetching payload from: ${payloadUrl}`);
                
                const payload = await httpWithAuth('GET', payloadUrl, username, password, null, 'application/octet-stream');
                
                console.log(`      ✓ Payload fetched (${payload.length} bytes)`);
                console.log(`      Payload content:`, payload);
                
                // Store first payload as main payload
                if (j === 0) {
                  messageData.payload = payload;
                }
                
                messageData.attachments.push({
                  id: attachmentId,
                  name: attachmentName,
                  payload: payload
                });
                
              } catch (payloadError) {
                console.error(`      ✗ Failed to fetch payload:`, payloadError.message);
              }
            }
          } else {
            console.log(`  No attachments found for this message`);
          }
          
        } catch (attachmentError) {
          console.error(`  ✗ Failed to fetch attachments:`, attachmentError.message);
        }
        
        messagesWithPayloads.push(messageData);
      }
      
      console.log('\n=== FINISHED FETCHING ATTACHMENTS AND PAYLOADS ===');
      
      // Group by iFlow
      const iflowSummary = {};
      messagesWithPayloads.forEach(msg => {
        const iflowName = msg.IntegrationFlowName || 'Unknown';
        if (!iflowSummary[iflowName]) {
          iflowSummary[iflowName] = {
            name: iflowName,
            failedCount: 0,
            messages: []
          };
        }
        iflowSummary[iflowName].failedCount++;
        iflowSummary[iflowName].messages.push(msg);
      });
      
      // SAVE PAYLOADS TO STORAGE
      console.log('\n=== SAVING PAYLOADS TO STORAGE ===');
      try {
        const allPayloads = await getAllSavedPayloads();
        
        // Save messages grouped by iFlow
        Object.keys(iflowSummary).forEach(iflowName => {
          const iflowMessages = iflowSummary[iflowName].messages;
          
          // Convert to storage format
          const payloadsToSave = iflowMessages.map(msg => ({
            messageGuid: msg.MessageGuid,
            integrationFlowName: msg.IntegrationFlowName,
            status: msg.Status,
            errorText: msg.CustomStatus || '',
            errorDetails: '',
            logStart: msg.LogStart,
            payload: msg.payload,
            attachments: msg.attachments.map(att => ({
              id: att.id,
              name: att.name,
              contentType: 'application/xml'
            }))
          }));
          
          allPayloads[iflowName] = payloadsToSave;
          console.log(`  Saved ${payloadsToSave.length} payloads for iFlow: ${iflowName}`);
        });
        
        // Save to Chrome storage
        await new Promise((resolve, reject) => {
          chrome.storage.local.set({ resenderPayloads: allPayloads }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });
        
        console.log('✓ All payloads saved to storage successfully');
      } catch (storageError) {
        console.error('✗ Failed to save payloads to storage:', storageError);
      }
      
      return { baseUrl, isNEO, iflowSummary: Object.values(iflowSummary), allMessages: messagesWithPayloads, username, password };
      
    } catch (error) {
      console.error('Error fetching MessageProcessingLogs:', error);
      throw error;
    }
  }

  async function handleResenderClick(status) {
    const savedData = await safeStorageGet(['resenderUrl', 'resenderUsername', 'resenderPassword']);
    
    if (!chrome.runtime?.id) {
      status.textContent = 'Extension context invalidated. Please reload the page.';
      return;
    }
    
    if (savedData.resenderUrl && savedData.resenderUsername && savedData.resenderPassword) {
      // Auto-connect with saved credentials and show overview
      status.textContent = 'Loading resender overview with saved credentials...';
      try{
        const iflowSummary = await fetchResenderOverview(savedData.resenderUrl, savedData.resenderUsername, savedData.resenderPassword);
        return { success: true, iflowSummary, credentials: savedData };
      }catch(e){
        status.textContent = 'Saved credentials failed, please re-enter';
        return { success: false, error: e };
      }
    } else {
      // No saved credentials
      return { success: false, needsAuth: true };
    }
  }

  async function updateResenderButtonText(){
    const buttons = document.querySelectorAll('#cpi-lite-resender');
    buttons.forEach(button => {
      button.textContent = 'Resender Interface';
      button.title = 'Click to load resender messages (auto-discovery)';
    });
  }

  async function showAuthDialogForResender(onConfirm){
    console.log('showAuthDialogForResender called');
    // Try to load saved credentials first
    const savedData = await safeStorageGet(['resenderUsername', 'resenderPassword', 'resenderApiUrl', 'resenderClientId', 'resenderClientSecret']);
    console.log('Dialog will show with saved data:', savedData);

    // Detect environment: NEO has /itspaces/, Cloud Foundry doesn't
    const isNEO = location.href.includes('/itspaces/');
    const environmentName = isNEO ? 'NEO' : 'Cloud Foundry';
    console.log('Detected environment:', environmentName);

    // Build dialog HTML based on environment
    let dialogHTML = `
      <h3 style="margin:0 0 16px">Resender Interface Authentication (${environmentName})</h3>
      <p style="margin:0 0 12px; font-size:13px; color:#666;">Please enter your credentials to access the resender interface</p>`;
    
    // For Cloud Foundry, add API URL field
    if (!isNEO) {
      dialogHTML += `
      <label>API URL: <input type="text" id="cpi-lite-auth-apiurl" placeholder="https://your-tenant.cfapps.region.hana.ondemand.com" value="${savedData.resenderApiUrl || ''}" style="font-family:monospace; font-size:12px;" /></label>`;
    }
    
    dialogHTML += `
      <label>Username: <input type="text" id="cpi-lite-auth-username" autocomplete="username" placeholder="SAP Username (for API calls)" value="${savedData.resenderUsername || ''}" /></label>
      <label>Password: <input type="password" id="cpi-lite-auth-password" autocomplete="current-password" placeholder="SAP Password (for API calls)" value="${savedData.resenderPassword || ''}" /></label>`;
    
    // For Cloud Foundry, add Client ID/Secret fields
    if (!isNEO) {
      dialogHTML += `
      <label>Client ID: <input type="text" id="cpi-lite-auth-clientid" placeholder="Client ID (for iFlow calls)" value="${savedData.resenderClientId || ''}" style="font-family:monospace; font-size:12px;" /></label>
      <label>Client Secret: <input type="password" id="cpi-lite-auth-clientsecret" placeholder="Client Secret (for iFlow calls)" value="${savedData.resenderClientSecret || ''}" style="font-family:monospace; font-size:12px;" /></label>`;
    }
    
    dialogHTML += `
      <div style="margin-top:8px; font-size:11px; color:#888;">
        <strong>Note:</strong> ${isNEO ? 'Credentials are saved locally.' : 'Username/Password for ServiceEndpoints API. Client ID/Secret for iFlow calls.'} 
      </div>
      <div class="cpi-lite-dialog-buttons">
        <button class="cpi-lite-btn" id="cpi-lite-auth-cancel">Cancel</button>
        <button class="cpi-lite-btn" id="cpi-lite-auth-clear" style="background:#dc3545;">Clear Saved</button>
        <button class="cpi-lite-btn" id="cpi-lite-auth-confirm">Connect</button>
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'cpi-lite-dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'cpi-lite-dialog';
    dialog.innerHTML = dialogHTML;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    const closeDialog = ()=>{
      overlay.remove();
    };
    
    overlay.addEventListener('click', (e)=>{
      if (e.target === overlay) closeDialog();
    });
    
    dialog.querySelector('#cpi-lite-auth-cancel').addEventListener('click', closeDialog);
    
    dialog.querySelector('#cpi-lite-auth-clear').addEventListener('click', ()=>{
      try {
        if (!chrome.runtime?.id) {
          alert('Extension context invalidated. Please reload the page.');
          return;
        }
        
        chrome.storage.local.remove(['resenderUsername', 'resenderPassword', 'resenderApiUrl', 'resenderClientId', 'resenderClientSecret'], ()=>{
          if (chrome.runtime.lastError) {
            alert('Failed to clear credentials: ' + chrome.runtime.lastError.message);
          } else {
            dialog.querySelector('#cpi-lite-auth-username').value = '';
            dialog.querySelector('#cpi-lite-auth-password').value = '';
            const apiUrlField = dialog.querySelector('#cpi-lite-auth-apiurl');
            if (apiUrlField) apiUrlField.value = '';
            const clientIdField = dialog.querySelector('#cpi-lite-auth-clientid');
            if (clientIdField) clientIdField.value = '';
            const clientSecretField = dialog.querySelector('#cpi-lite-auth-clientsecret');
            if (clientSecretField) clientSecretField.value = '';
            updateResenderButtonText();
            alert('Saved credentials cleared');
          }
        });
      } catch (error) {
        alert('Failed to clear credentials: ' + error.message);
      }
    });
    
    dialog.querySelector('#cpi-lite-auth-confirm').addEventListener('click', ()=>{
      const username = dialog.querySelector('#cpi-lite-auth-username').value.trim();
      const password = dialog.querySelector('#cpi-lite-auth-password').value;
      const apiUrlField = dialog.querySelector('#cpi-lite-auth-apiurl');
      const apiUrl = apiUrlField ? apiUrlField.value.trim() : null;
      const clientIdField = dialog.querySelector('#cpi-lite-auth-clientid');
      const clientId = clientIdField ? clientIdField.value.trim() : null;
      const clientSecretField = dialog.querySelector('#cpi-lite-auth-clientsecret');
      const clientSecret = clientSecretField ? clientSecretField.value : null;
      
      if (!username){
        alert('Please enter your SAP username');
        return;
      }
      
      if (!password){
        alert('Please enter your SAP password');
        return;
      }
      
      // For Cloud Foundry, validate API URL and Client credentials
      if (!isNEO) {
        if (!apiUrl) {
          alert('Please enter the API URL for Cloud Foundry');
          return;
        }
        if (!clientId) {
          alert('Please enter Client ID for iFlow calls');
          return;
        }
        if (!clientSecret) {
          alert('Please enter Client Secret for iFlow calls');
          return;
        }
      }
      
      // Save credentials for future use
      try {
        if (!chrome.runtime?.id) {
          console.log('Extension context invalidated, credentials not saved');
        } else {
          const dataToSave = {
            resenderUsername: username,
            resenderPassword: password
          };
          
          // Save API URL and Client credentials only for Cloud Foundry
          if (!isNEO) {
            if (apiUrl) dataToSave.resenderApiUrl = apiUrl;
            if (clientId) dataToSave.resenderClientId = clientId;
            if (clientSecret) dataToSave.resenderClientSecret = clientSecret;
          }
          
          chrome.storage.local.set(dataToSave, ()=>{
            if (chrome.runtime.lastError) {
              console.log('Failed to save credentials:', chrome.runtime.lastError.message);
            } else {
              console.log('Resender credentials saved:', dataToSave);
              updateResenderButtonText();
            }
          });
        }
      } catch (error) {
        console.log('Failed to save credentials:', error.message);
      }
      
      closeDialog();
      onConfirm(null, username, password, apiUrl); // Pass apiUrl as 4th parameter
    });

    // Focus on username field
    setTimeout(()=>{
      dialog.querySelector('#cpi-lite-auth-username').focus();
    }, 100);
  }

  // ============ RESENDER UI FUNCTIONS ============

  function showIflowOverview(data, container) {
    ensureStyles();
    
    // Clear container and create new content
    container.innerHTML = '';
    
    const page = document.createElement('section');
    page.className = 'cpi-lite-body';
    
    // Header
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back';
    back.onclick = () => { location.reload(); };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = 'Failed Messages - iFlow Overview (Last 15 mins)';
    header.appendChild(back);
    header.appendChild(title);
    
    // Table
    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:70%">iFlow Name</th>
          <th style="width:30%" class="cpi-lite-count">Failed Count</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    
    const tbody = table.querySelector('tbody');
    
    data.iflowSummary.forEach(iflow => {
      const tr = document.createElement('tr');
      
      const tdName = document.createElement('td');
      tdName.textContent = iflow.name;
      
      const tdFailed = document.createElement('td');
      tdFailed.className = 'cpi-lite-count cpi-lite-fail';
      const failLink = document.createElement('a');
      failLink.href = '#';
      failLink.className = 'cpi-lite-link';
      failLink.textContent = iflow.failedCount.toString();
      failLink.onclick = (e) => {
        e.preventDefault();
        showFailedMessages(iflow, data, container);
      };
      tdFailed.appendChild(failLink);
      
      tr.appendChild(tdName);
      tr.appendChild(tdFailed);
      tbody.appendChild(tr);
    });
    
    page.appendChild(header);
    page.appendChild(table);
    container.appendChild(page);
  }

  function showFailedMessages(iflow, data, container) {
    ensureStyles();
    
    // Clear container
    container.innerHTML = '';
    
    const page = document.createElement('section');
    page.className = 'cpi-lite-body';
    
    // Header
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back to Overview';
    back.onclick = () => { showIflowOverview(data, container); };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = `Failed Messages - ${iflow.name}`;
    header.appendChild(back);
    header.appendChild(title);
    
    // Controls
    const controls = document.createElement('div');
    controls.style.cssText = 'padding:12px; background:rgba(0,0,0,.03); margin:12px 0; border-radius:6px;';
    controls.innerHTML = `
      <div style="display:flex; gap:12px; align-items:center;">
        <button id="select-all-btn" class="cpi-lite-btn">Select All</button>
        <button id="resend-btn" class="cpi-lite-btn" disabled>Resend Selected (0)</button>
        <span id="resend-status" style="margin-left:8px; color:#666;"></span>
      </div>
    `;
    
    // Table
    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:5%"><input type="checkbox" id="select-all-checkbox"></th>
          <th style="width:30%">Message GUID</th>
          <th style="width:20%">iFlow Name</th>
          <th style="width:15%">Log Start</th>
          <th style="width:10%">Payload</th>
          <th style="width:20%">Status</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    
    const tbody = table.querySelector('tbody');
    
    iflow.messages.forEach(msg => {
      const tr = document.createElement('tr');
      
      const tdCheck = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'message-checkbox';
      checkbox.dataset.messageGuid = msg.MessageGuid;
      checkbox.disabled = !msg.payload; // Only enable if payload exists
      tdCheck.appendChild(checkbox);
      
      const tdGuid = document.createElement('td');
      tdGuid.style.fontFamily = 'monospace';
      tdGuid.style.fontSize = '11px';
      tdGuid.textContent = msg.MessageGuid.substring(0, 36);
      
      const tdIflow = document.createElement('td');
      tdIflow.textContent = msg.IntegrationFlowName;
      
      const tdStart = document.createElement('td');
      tdStart.style.fontSize = '11px';
      tdStart.textContent = msg.LogStart ? new Date(msg.LogStart).toLocaleString() : '-';
      
      const tdPayload = document.createElement('td');
      tdPayload.textContent = msg.payload ? '✓ Yes' : '✗ No';
      tdPayload.style.color = msg.payload ? 'green' : 'red';
      
      const tdStatus = document.createElement('td');
      tdStatus.textContent = msg.Status;
      
      tr.appendChild(tdCheck);
      tr.appendChild(tdGuid);
      tr.appendChild(tdIflow);
      tr.appendChild(tdStart);
      tr.appendChild(tdPayload);
      tr.appendChild(tdStatus);
      tbody.appendChild(tr);
    });
    
    page.appendChild(header);
    page.appendChild(controls);
    page.appendChild(table);
    container.appendChild(page);
    
    // Wire up checkbox handlers
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const selectAllBtn = document.getElementById('select-all-btn');
    const resendBtn = document.getElementById('resend-btn');
    const resendStatus = document.getElementById('resend-status');
    const messageCheckboxes = document.querySelectorAll('.message-checkbox:not([disabled])');
    
    const updateResendButton = () => {
      const checkedCount = document.querySelectorAll('.message-checkbox:checked').length;
      resendBtn.textContent = `Resend Selected (${checkedCount})`;
      resendBtn.disabled = checkedCount === 0;
    };
    
    selectAllCheckbox.onchange = () => {
      messageCheckboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
      updateResendButton();
    };
    
    selectAllBtn.onclick = () => {
      const allChecked = Array.from(messageCheckboxes).every(cb => cb.checked);
      messageCheckboxes.forEach(cb => cb.checked = !allChecked);
      selectAllCheckbox.checked = !allChecked;
      updateResendButton();
    };
    
    messageCheckboxes.forEach(cb => {
      cb.onchange = updateResendButton;
    });
    
    resendBtn.onclick = async () => {
      const selectedCheckboxes = document.querySelectorAll('.message-checkbox:checked');
      const selectedGuids = Array.from(selectedCheckboxes).map(cb => cb.dataset.messageGuid);
      
      if (selectedGuids.length === 0) return;
      
      if (!confirm(`Resend ${selectedGuids.length} message(s)?`)) return;
      
      resendBtn.disabled = true;
      resendStatus.textContent = 'Resending...';
      
      try {
        const result = await resendSelectedMessages(selectedGuids, iflow.messages, data);
        resendStatus.textContent = '';
        alert(`Resend complete!\n\nSuccess: ${result.successCount}\nFailed: ${result.failedCount}\nTotal: ${result.total}`);
      } catch (error) {
        resendStatus.textContent = 'Error: ' + error.message;
        alert('Failed to resend messages: ' + error.message);
      } finally {
        resendBtn.disabled = false;
      }
    };
  }

  async function resendSelectedMessages(selectedGuids, allMessages, data) {
    try {
      const { baseUrl, username, password, isNEO } = data;
      
      if (!selectedGuids || selectedGuids.length === 0) {
        throw new Error('No messages selected');
      }
      
      // Get iFlow name from first message (all selected messages should be from same iFlow)
      const firstMessage = allMessages.find(msg => selectedGuids.includes(msg.MessageGuid));
      if (!firstMessage) {
        throw new Error('Selected messages not found');
      }
      
      const iflowSymbolicName = firstMessage.IntegrationFlowName;
      console.log('iFlow symbolic name:', iflowSymbolicName);
      
      // STEP 1: Load stored payloads from local storage
      console.log('Loading payloads from storage...');
      const allPayloads = await getAllSavedPayloads();
      const savedPayloads = allPayloads[iflowSymbolicName] || [];
      
      console.log(`Found ${savedPayloads.length} saved payloads for iFlow: ${iflowSymbolicName}`);
      
      if (savedPayloads.length === 0) {
        throw new Error('No saved payloads found. Please fetch payloads first.');
      }
      
      // STEP 2: Determine base URL and credentials
      let serviceEndpointsBaseUrl;
      let apiUsername = username;
      let apiPassword = password;
      
      if (isNEO) {
        // NEO: Use current host
        serviceEndpointsBaseUrl = window.location.protocol + '//' + window.location.host;
        console.log('NEO environment detected, using current host:', serviceEndpointsBaseUrl);
      } else {
        // Cloud Foundry: Get API URL from storage
        const savedData = await safeStorageGet(['resenderApiUrl', 'resenderClientId', 'resenderClientSecret']);
        
        const apiUrl = savedData.resenderApiUrl;
        if (!apiUrl) {
          throw new Error('API URL is required for Cloud Foundry environment. Please configure resender interface first.');
        }
        
        serviceEndpointsBaseUrl = apiUrl.replace(/\/$/, ''); // Remove trailing slash if present
        console.log('Cloud Foundry environment detected, using API URL:', serviceEndpointsBaseUrl);
        
        // Use Client ID/Secret for API calls
        if (savedData.resenderClientId && savedData.resenderClientSecret) {
          apiUsername = savedData.resenderClientId;
          apiPassword = savedData.resenderClientSecret;
          console.log('Using Client ID/Secret for API calls');
        }
      }
      
      // STEP 3: Discover iFlow endpoint automatically using ServiceEndpoints API
      const serviceEndpointsUrl = serviceEndpointsBaseUrl + `/api/v1/ServiceEndpoints?$select=EntryPoints/Name,EntryPoints/Url&$expand=EntryPoints&$filter=Name eq '${iflowSymbolicName.trim()}'`;
      
      console.log('Step 1: Fetching ServiceEndpoints from:', serviceEndpointsUrl);
      
      // Call ServiceEndpoints API - use httpWithAuth to handle cross-origin (CF) and same-origin (NEO)
      const serviceEndpointsXml = await httpWithAuth('GET', serviceEndpointsUrl, apiUsername, apiPassword, null, 'application/xml');
      console.log('ServiceEndpoints response length:', serviceEndpointsXml ? serviceEndpointsXml.length : 0);
      
      // Step 2: Parse XML to extract the actual endpoint URL from <d:Url>
      const parsed = new XmlToJson().parse(serviceEndpointsXml);
      console.log('Parsed ServiceEndpoints structure:', parsed);
      
      // Navigate through XML to find <d:Url>
      let endpoint = null;
      const findUrl = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj['d:Url']) return obj['d:Url'];
        if (obj['Url']) return obj['Url'];
        for (const key in obj) {
          const result = findUrl(obj[key]);
          if (result) return result;
        }
        return null;
      };
      
      endpoint = findUrl(parsed);
      
      if (!endpoint) {
        throw new Error('Could not find endpoint URL in ServiceEndpoints response');
      }
      
      console.log('Step 2: Extracted endpoint URL:', endpoint);
      
      // STEP 4: Resend each selected message
      const results = [];
      
      for (let i = 0; i < selectedGuids.length; i++) {
        const messageGuid = selectedGuids[i];
        
        console.log(`[${i + 1}/${selectedGuids.length}] Processing message: ${messageGuid}`);
        
        // Find the saved payload from storage
        const savedMsg = savedPayloads.find(p => p.messageGuid === messageGuid);
        
        if (!savedMsg || !savedMsg.payload) {
          console.error(`✗ No payload found for message: ${messageGuid}`);
          results.push({
            messageGuid: messageGuid,
            success: false,
            error: 'No payload found in storage'
          });
          continue;
        }
        
        try {
          console.log(`Resending message ${messageGuid} to ${endpoint}`);
          console.log(`Payload length: ${savedMsg.payload.length} bytes`);
          
          // Send HTTP POST request to the discovered endpoint
          // Use Basic Authentication (ClientID/ClientSecret or Username/Password)
          // Set Content-Type: application/xml
          // POST body is the original payload as-is
          await httpWithAuth('POST', endpoint, apiUsername, apiPassword, savedMsg.payload, 'application/xml');
          
          console.log(`✓ Successfully resent message ${messageGuid}`);
          results.push({
            messageGuid: messageGuid,
            success: true
          });
        } catch (error) {
          console.error(`✗ Failed to resend message ${messageGuid}:`, error.message);
          results.push({
            messageGuid: messageGuid,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;
      
      console.log(`Resend complete: ${successCount} succeeded, ${failedCount} failed`);
      
      return {
        successCount,
        failedCount,
        total: selectedGuids.length,
        results
      };
      
    } catch (error) {
      console.error('Error in resendSelectedMessages:', error);
      throw error;
    }
  }

  function parseResenderMessages(xmlText){
    try{
      // Validate input - should be a string, not an array
      if (Array.isArray(xmlText)) {
        console.error('parseResenderMessages called with array instead of XML string:', xmlText);
        return xmlText; // Return the array as-is since it's already parsed
      }
      
      if (!xmlText || typeof xmlText !== 'string') {
        console.error('parseResenderMessages called with invalid input:', typeof xmlText, xmlText);
        return [];
      }
      
      console.log('Raw XML received (length):', xmlText.length);
      const parsed = new XmlToJson().parse(xmlText);
      console.log('Parsed XML structure keys:', parsed ? Object.keys(parsed) : 'null');
      
      // Try different possible XML structures
      let messageList = [];
      
      // Structure 1: <messages><message>
      if (parsed && parsed.messages) {
        const messages = parsed.messages;
        messageList = Array.isArray(messages.message) ? messages.message : (messages.message ? [messages.message] : []);
        console.log('Found messages in structure 1:', messageList.length);
      }
      
      // Structure 2: Direct <message> elements
      if (messageList.length === 0 && parsed && parsed.message) {
        messageList = Array.isArray(parsed.message) ? parsed.message : [parsed.message];
        console.log('Found messages in structure 2:', messageList.length);
      }
      
      // Structure 3: Root element contains messages directly
      if (messageList.length === 0 && parsed) {
        // Look for any property that might contain message data
        for (const [key, value] of Object.entries(parsed)) {
          if (key.toLowerCase().includes('message') || key.toLowerCase().includes('entry')) {
            messageList = Array.isArray(value) ? value : [value];
            console.log(`Found messages in structure 3 (${key}):`, messageList.length);
            break;
          }
        }
      }
      
      // Structure 4: Check if the parsed object itself is a message
      if (messageList.length === 0 && parsed && (parsed.id || parsed.Id || parsed.EntryID || parsed.MessageGuid)) {
        messageList = [parsed];
        console.log('Found single message in structure 4:', messageList.length);
      }
      
      console.log('Final message list:', messageList);
      
      return messageList.map(msg => {
        console.log('Processing message:', msg);
        const finalPayload = msg.FinalPayload || msg.finalPayload || msg;
        return {
          id: msg.id || msg.Id || msg.ID || '',
          entryId: finalPayload.EntryID || finalPayload.entryId || '',
          iFlowId: finalPayload.IFlowID || finalPayload.iFlowId || '',
          iFlowName: finalPayload.IFlowName || finalPayload.iFlowName || msg.IFlowName || msg.iFlowName || 'Unknown iFlow',
          messageGuid: finalPayload.MessageGuid || finalPayload.messageGuid || msg.MessageGuid || msg.messageGuid || '',
          status: finalPayload.Status || finalPayload.status || msg.Status || msg.status || 'FAILED',
          payload: finalPayload.payload || finalPayload || {}
        };
      });
    }catch(e){
      console.error('XML parsing error:', e);
      throw new Error('Failed to parse resender messages: ' + (e && e.message || e));
    }
  }

  function createResenderSummary(messages) {
    const summary = new Map();
    
    messages.forEach(msg => {
      const iFlowName = (msg.iFlowName || '').trim() || 'Unknown iFlow';
      
      if (!summary.has(iFlowName)) {
        summary.set(iFlowName, {
          iFlowName: iFlowName,
          total: 0,
          completed: 0,
          failed: 0,
          messages: []
        });
      }
      
      const entry = summary.get(iFlowName);
      entry.total++;
      entry.messages.push(msg);
      
      const status = (msg.status || '').trim().toUpperCase();
      if (status === 'COMPLETED') {
        entry.completed++;
      } else if (status === 'FAILED') {
        entry.failed++;
      }
    });
    
    return Array.from(summary.values()).sort((a, b) => a.iFlowName.localeCompare(b.iFlowName));
  }

  // ============ STORAGE FUNCTIONS FOR PAYLOADS ============

  async function getAllSavedPayloads() {
    try {
      const result = await safeStorageGet(['resenderPayloads']);
      return result.resenderPayloads || {};
    } catch (error) {
      console.error('Error getting saved payloads:', error);
      return {};
    }
  }

  async function savePayloadsForIflow(iflowSymbolicName, messages) {
    try {
      const allPayloads = await getAllSavedPayloads();
      allPayloads[iflowSymbolicName] = messages;
      
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ resenderPayloads: allPayloads }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
      
      console.log(`Saved ${messages.length} payloads for iFlow: ${iflowSymbolicName}`);
    } catch (error) {
      console.error('Error saving payloads:', error);
      throw error;
    }
  }

  // ============ FETCH AND SAVE FAILED MESSAGES WITH PAYLOADS ============

  async function fetchAndSaveFailedMessagesWithPayloads(iflowSymbolicName, username, password, progressCallback) {
    try {
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
      
      if (progressCallback) progressCallback(`Fetching failed messages for ${iflowSymbolicName}...`);
      
      // Get failed messages for this iFlow
      const messages = await listFailedMessagesForIflow(iflowSymbolicName, 200);
      
      if (messages.length === 0) {
        if (progressCallback) progressCallback('No failed messages found');
        return [];
      }
      
      if (progressCallback) progressCallback(`Found ${messages.length} failed messages, fetching payloads...`);
      
      // Determine credentials for API calls
      let apiUsername = username;
      let apiPassword = password;
      
      if (!isNEO) {
        const savedData = await safeStorageGet(['resenderClientId', 'resenderClientSecret']);
        if (savedData.resenderClientId && savedData.resenderClientSecret) {
          apiUsername = savedData.resenderClientId;
          apiPassword = savedData.resenderClientSecret;
        }
      }
      
      // Fetch attachments and payloads for each message
      const messagesWithPayloads = [];
      
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        
        if (progressCallback) {
          progressCallback(`Processing ${i + 1}/${messages.length}: ${msg.messageId.substring(0, 8)}...`);
        }
        
        try {
          // Fetch attachments
          const attachmentsUrl = `${baseUrl}/api/v1/MessageProcessingLogs('${msg.messageId}')/Attachments?$format=json`;
          const attachmentsResponse = await httpWithAuth('GET', attachmentsUrl, apiUsername, apiPassword, null, 'application/json');
          const attachmentsJson = JSON.parse(attachmentsResponse);
          const attachments = attachmentsJson.value || attachmentsJson.d?.results || [];
          
          if (attachments.length > 0) {
            // Fetch payload from first attachment
            const firstAttachment = attachments[0];
            const attachmentId = firstAttachment.Id || firstAttachment.ID;
            
            // Note: The URL structure varies between environments
            // Try the integrationsuite domain first (CF), then fall back to it-cpitrial domain
            let payloadUrl = `${baseUrl}/api/v1/MessageProcessingLogAttachments('${attachmentId}')/$value`;
            
            // For CF environments, we might need to use the integrationsuite subdomain
            if (!isNEO && baseUrl.includes('.cfapps.')) {
              // Replace it-cpitrial with integrationsuite-trial or similar
              payloadUrl = payloadUrl.replace(/\/\/[^.]+\.it-cpi/, '//trial-xp03lcjj.integrationsuite-');
            }
            
            const payload = await httpWithAuth('GET', payloadUrl, apiUsername, apiPassword, null, 'application/octet-stream');
            
            messagesWithPayloads.push({
              messageGuid: msg.messageId,
              integrationFlowName: iflowSymbolicName,
              status: msg.status,
              errorText: msg.errorText,
              errorDetails: msg.errorDetails,
              logStart: msg.logStart,
              payload: payload,
              attachments: attachments.map(att => ({
                id: att.Id || att.ID,
                name: att.Name || att.name,
                contentType: att.ContentType || att.contentType
              }))
            });
          } else {
            // No attachments found
            messagesWithPayloads.push({
              messageGuid: msg.messageId,
              integrationFlowName: iflowSymbolicName,
              status: msg.status,
              errorText: msg.errorText,
              errorDetails: msg.errorDetails,
              logStart: msg.logStart,
              payload: null,
              attachments: []
            });
          }
        } catch (error) {
          console.error(`Error fetching payload for message ${msg.messageId}:`, error);
          messagesWithPayloads.push({
            messageGuid: msg.messageId,
            integrationFlowName: iflowSymbolicName,
            status: msg.status,
            errorText: msg.errorText,
            errorDetails: msg.errorDetails,
            logStart: msg.logStart,
            payload: null,
            attachments: [],
            error: error.message
          });
        }
      }
      
      // Save to storage
      await savePayloadsForIflow(iflowSymbolicName, messagesWithPayloads);
      
      if (progressCallback) {
        progressCallback(`Successfully saved ${messagesWithPayloads.length} messages with payloads`);
      }
      
      return messagesWithPayloads;
      
    } catch (error) {
      console.error('Error in fetchAndSaveFailedMessagesWithPayloads:', error);
      if (progressCallback) progressCallback(`Error: ${error.message}`);
      throw error;
    }
  }

  // ============ RESEND SELECTED MESSAGES (FROM STORAGE) ============

  async function resendSelectedMessagesFromStorage(selectedMessages, iflowSymbolicName, username, password, statusCallback) {
    try {
      if (!selectedMessages || selectedMessages.length === 0) {
        throw new Error('No messages selected');
      }
      
      // Get saved payloads
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
      
      // Determine credentials
      let apiUsername = username;
      let apiPassword = password;
      
      if (!isNEO) {
        const savedData = await safeStorageGet(['resenderClientId', 'resenderClientSecret']);
        if (savedData.resenderClientId && savedData.resenderClientSecret) {
          apiUsername = savedData.resenderClientId;
          apiPassword = savedData.resenderClientSecret;
        }
      }
      
      if (statusCallback) statusCallback(`Fetching iFlow endpoint...`);
      
      // Fetch iFlow endpoint
      const filter = `Name eq '${iflowSymbolicName.replace(/'/g, "''")}'`;
      const endpointUrl = `${baseUrl}/api/v1/IntegrationRuntimeArtifacts?$filter=${encodeURIComponent(filter)}&$expand=EntryPoints&$format=json`;
      const endpointResponse = await httpWithAuth('GET', endpointUrl, apiUsername, apiPassword, null, 'application/json');
      const endpointJson = JSON.parse(endpointResponse);
      const artifacts = endpointJson.value || endpointJson.d?.results || [];
      
      if (artifacts.length === 0) {
        throw new Error(`No endpoint found for iFlow: ${iflowSymbolicName}`);
      }
      
      const artifact = artifacts[0];
      const entryPoints = artifact.EntryPoints || artifact.entryPoints || [];
      
      if (entryPoints.length === 0) {
        throw new Error(`No entry points found for iFlow: ${iflowSymbolicName}`);
      }
      
      const httpEntry = entryPoints.find(ep => 
        (ep.Type || ep.type || '').toLowerCase().includes('http')
      ) || entryPoints[0];
      
      const endpoint = httpEntry.Url || httpEntry.url;
      
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
            success: false,
            error: 'No payload found'
          });
          continue;
        }
        
        try {
          // Resend the message
          await httpWithAuth('POST', endpoint, apiUsername, apiPassword, savedMsg.payload, 'application/xml');
          
          results.push({
            messageGuid: messageId,
            success: true
          });
        } catch (error) {
          results.push({
            messageGuid: messageId,
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

  // Handle requests from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
    if (msg && msg.type === 'CPI_LITE_LOAD'){
      (async ()=>{
        try{
          const data = await collect();
          sendResponse({ ok:true, data });
        }catch(e){
          sendResponse({ ok:false, error: String(e && e.message || e) });
        }
      })();
      return true; // async response
    }
  });

  // ============ In-page embedding (left navigation entry + panel) ============
  // This code injects a left navigation item named "CPI Helper Lite" into the
  // SAP Integration Suite side navigation. Clicking the item opens an in-page
  // panel that renders the same iFlows table as the popup.

  function ensureStyles(){
    if (document.getElementById('cpi-lite-embed-style')) return;
    const style = document.createElement('style');
    style.id = 'cpi-lite-embed-style';
    style.textContent = `
      .cpi-lite-panel{position:fixed; inset:auto 0 0 auto; top:64px; right:16px; width:min(860px, 92vw); height:calc(100vh - 80px); background:#fff; color:#1b1b1b; box-shadow:0 6px 24px rgba(0,0,0,.2); border-radius:8px; display:flex; flex-direction:column; z-index:2147483000;}
      .cpi-lite-dark .cpi-lite-panel{background:#1c2834; color:#eaecef;}
      #cpi-lite-page-root{ height:100%; display:flex; flex-direction:column; }
      .cpi-lite-header{display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid rgba(0,0,0,.08)}
      .cpi-lite-dark .cpi-lite-header{border-bottom-color:rgba(255,255,255,.12)}
      .cpi-lite-title{font-size:14px; font-weight:600}
      .cpi-lite-close{border:none; background:transparent; cursor:pointer; font-size:16px}
      .cpi-lite-body{padding:12px; overflow:auto; height:100%; flex:1;}
      .cpi-lite-table{border-collapse:collapse; width:100%}
      .cpi-lite-table th,.cpi-lite-table td{border-bottom:1px solid rgba(0,0,0,.06); padding:8px; text-align:left}
      .cpi-lite-table th{background:rgba(0,0,0,.03); position:sticky; top:0; z-index:1}
      .cpi-lite-count{ text-align:right }
      .cpi-lite-ok{ color:#2c7a2c }
      .cpi-lite-fail{ color:#c53030 }
      .cpi-lite-nav-btn{ display:flex; align-items:center; gap:8px; padding:8px 10px; margin:6px 8px; border-radius:6px; cursor:pointer; user-select:none;}
      .cpi-lite-nav-btn:hover{ background:rgba(0,0,0,.06) }
      .cpi-lite-hidden{ display:none !important }
      .cpi-lite-controls{ display:flex; gap:12px; align-items:center; margin:12px 0 }
      .cpi-lite-input{ padding:6px 8px; border:1px solid rgba(0,0,0,.2); border-radius:6px; width:110px }
      .cpi-lite-btn{ padding:6px 12px; border:1px solid rgba(0,0,0,.2); border-radius:6px; background:#1f2d40; color:#fff; cursor:pointer }
      .cpi-lite-btn:disabled{ opacity:.6; cursor:default }
      .cpi-lite-pager{ display:flex; gap:8px; align-items:center; margin:10px 0 }
      .cpi-lite-link{ color:#0a66c2; cursor:pointer; user-select:none }
      .cpi-lite-back{ padding:6px 10px; border:1px solid rgba(0,0,0,.2); border-radius:6px; background:#eef3f8; color:#1b1b1b; cursor:pointer; margin-right:8px }
      .cpi-lite-checkbox{ margin:0 8px 0 0; cursor:pointer }
      .cpi-lite-dialog{ position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:#fff; padding:20px; border-radius:8px; box-shadow:0 6px 24px rgba(0,0,0,.3); z-index:2147483100; min-width:400px }
      .cpi-lite-dark .cpi-lite-dialog{ background:#1c2834; color:#eaecef }
      .cpi-lite-dialog-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:2147483099 }
      .cpi-lite-dialog input{ width:100%; padding:8px; margin:8px 0; border:1px solid rgba(0,0,0,.2); border-radius:4px; box-sizing:border-box }
      .cpi-lite-dialog-buttons{ display:flex; gap:8px; justify-content:flex-end; margin-top:16px }
      .cpi-lite-select-all{ margin-right:8px; padding:6px 12px; border:1px solid rgba(0,0,0,.2); border-radius:6px; background:#f6f6f6; color:#1b1b1b; cursor:pointer }
    `;
    document.head.appendChild(style);
  }

  function isDark(){
    // UI5 Horizon dark theme class
    return document.documentElement.classList.contains('sapUiTheme-sap_horizon_dark');
  }

  function renderInPage(rows){
    ensureStyles();
    const rootId = 'cpi-lite-panel-root';
    let root = document.getElementById(rootId);
    const wrapperClass = isDark() ? 'cpi-lite-dark' : '';
    if (!root){
      root = document.createElement('div');
      root.id = rootId;
      root.className = wrapperClass;
      document.body.appendChild(root);
    } else {
      root.className = wrapperClass;
      root.innerHTML = '';
    }

    const panel = document.createElement('div');
    panel.className = 'cpi-lite-panel';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = 'iFlows and Message Counts';
    const close = document.createElement('button');
    close.className = 'cpi-lite-close';
    close.setAttribute('aria-label','Close');
    close.textContent = '✕';
    close.onclick = ()=> root.remove();
    header.appendChild(title);
    header.appendChild(close);

    const body = document.createElement('div');
    body.className = 'cpi-lite-body';
    // Controls
    const controls = document.createElement('div');
    controls.className = 'cpi-lite-controls';
    controls.innerHTML = `
      <label>BatchSize: <input id="cpi-lite-batch" class="cpi-lite-input" type="number" min="1" step="1" value="${state.batchSize}"></label>
      <button id="cpi-lite-load" class="cpi-lite-btn">Get Message Overview</button>
      <button id="cpi-lite-resender" class="cpi-lite-btn">Resender Interface</button>
      <span id="cpi-lite-status" style="margin-left:8px; color:#666;"></span>
    `;
    body.appendChild(controls);
    // Pagination section
    const pager = document.createElement('div');
    pager.className = 'cpi-lite-pager';
    pager.innerHTML = `
      <span id="cpi-lite-prev" class="cpi-lite-link">Prev</span>
      <span id="cpi-lite-page"></span>
      <span id="cpi-lite-next" class="cpi-lite-link">Next</span>
    `;
    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:55%">iFlow</th><th style="width:22%" class="cpi-lite-count">Completed</th><th style="width:23%" class="cpi-lite-count">Failed</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    const fmt = n=> new Intl.NumberFormat().format(n);
    const rowsToRender = Array.isArray(rows) ? rows : [];
    rowsToRender.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    const start = state.pageIndex * state.batchSize;
    const pageRows = rowsToRender.slice(start, start + state.batchSize);
    for (const r of pageRows){
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const tdOk = document.createElement('td');
      const tdFail = document.createElement('td');
      tdName.textContent = r.name || r.symbolicName;
      tdOk.textContent = fmt(r.completed||0);
      const failLink = document.createElement('a');
      failLink.href = '#';
      failLink.className = 'cpi-lite-link cpi-lite-fail';
      failLink.textContent = fmt(r.failed||0);
      failLink.addEventListener('click', (ev)=>{ ev.preventDefault(); showFailedFor(r.symbolicName || r.name, r.name || r.symbolicName); });
      tdFail.appendChild(failLink);
      tdOk.className = 'cpi-lite-count cpi-lite-ok';
      tdFail.className = 'cpi-lite-count';
      tr.appendChild(tdName);
      tr.appendChild(tdOk);
      tr.appendChild(tdFail);
      tbody.appendChild(tr);
    }
    body.appendChild(table);
    body.appendChild(pager);

    panel.appendChild(header);
    panel.appendChild(body);
    root.appendChild(panel);

    // Wire controls
    const batchInput = root.querySelector('#cpi-lite-batch');
    const prev = root.querySelector('#cpi-lite-prev');
    const next = root.querySelector('#cpi-lite-next');
    const page = root.querySelector('#cpi-lite-page');
    const status = root.querySelector('#cpi-lite-status');
    const totalPages = Math.max(1, Math.ceil(rowsToRender.length / state.batchSize));
    page.textContent = `${rowsToRender.length ? state.pageIndex+1 : 0} / ${totalPages}`;
    prev.onclick = ()=>{ if (state.pageIndex>0){ state.pageIndex--; renderInPage(state.cachedRows); }};
    next.onclick = ()=>{ if ((state.pageIndex+1) < totalPages){ state.pageIndex++; renderInPage(state.cachedRows); }};
    batchInput.onchange = ()=>{
      const v = Math.max(1, parseInt(batchInput.value,10)||1);
      state.batchSize = v;
      state.pageIndex = 0;
      renderInPage(state.cachedRows);
    };
    root.querySelector('#cpi-lite-load')?.addEventListener('click', async ()=>{
      status.textContent = 'Loading...';
      try{
        const data = await collect();
        state.cachedRows = Array.isArray(data)? data : [];
        state.pageIndex = 0;
        status.textContent = `Loaded ${state.cachedRows.length} iFlows`;
        renderInPage(state.cachedRows);
      }catch(e){
        status.textContent = String(e && e.message || e);
      }
    });
    root.querySelector('#cpi-lite-resender')?.addEventListener('click', async ()=>{
      // Show dialog and fetch logs, then show iFlow overview
      showAuthDialogForResender(async (url, username, password, apiUrl)=>{
        status.textContent = 'Fetching failed messages (last 15 mins)...';
        try{
          const data = await fetchMessageProcessingLogs(username, password, apiUrl);
          status.textContent = `Found ${data.iflowSummary.length} iFlows with failed messages`;
          
          // Show iFlow overview screen
          showIflowOverview(data, root);
        }catch(e){
          status.textContent = String(e && e.message || e);
          alert('Failed to fetch logs: ' + String(e && e.message || e));
        }
      });
    });
  }

  function findMainContentContainer(){
    // Try a wide range of selectors used by UI5 ToolPage layouts
    const candidates = [
      // Integration Suite split app detail area (matches Sprintegrate placement)
      document.querySelector('#shell--splitApp-Detail'),
      document.querySelector('#mainPage-cont'),
      document.querySelector('#mainPage'),
      // ToolPage main content wrappers
      // Common ToolPage content wrappers
      document.querySelector('[id$="--toolPage-contentWrapper"] .sapTntToolPageContent'),
      document.querySelector('[id$="--toolPage-contentWrapper"]'),
      document.querySelector('[id$="--toolPage-content"]'),
      document.querySelector('.sapTntToolPageContent'),
      document.querySelector('.sapTntToolPageMainContent'),
      document.querySelector('.sapTntToolPageContentWrapper'),
      // Shell/App containers seen in Integration Suite
      document.querySelector('#shell--content'),
      document.querySelector('#shell--contentContainer'),
      // Fallbacks
      document.querySelector('[id$="--pageContent"]'),
      document.querySelector('.fd-tool-page__content'),
      document.querySelector('main')
    ];
    const found = candidates.find(Boolean);
    if (found) return found;
    // As a last resort, pick the largest visible container right of the side nav
    try{
      const side = document.querySelector('[id$="--sideNavigation"], .sapTntSideNavigation');
      const sideRight = side ? side.getBoundingClientRect().right : 240;
      let best = null, bestArea = 0;
      document.querySelectorAll('body > *').forEach(el=>{
        const r = el.getBoundingClientRect();
        if (r.width>400 && r.height>300 && r.left >= sideRight){
          const area = r.width*r.height;
          if (area>bestArea){ bestArea=area; best=el; }
        }
      });
      return best;
    }catch(_e){
      return null;
    }
  }

  function renderFullPage(rows){
    ensureStyles();
    const container = findMainContentContainer();
    if (!container){
      // fallback to floating panel if tool page not found yet
      renderInPage(rows);
      return;
    }
    let root = container.querySelector('#cpi-lite-page-root');
    const wrapperClass = isDark() ? 'cpi-lite-dark' : '';
    if (!root){
      root = document.createElement('div');
      root.id = 'cpi-lite-page-root';
      container.appendChild(root);
    }
    root.className = wrapperClass;
    root.innerHTML = '';

    const page = document.createElement('section');
    page.className = 'cpi-lite-body';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = 'CPI Helper Lite';
    header.appendChild(title);
    const controls = document.createElement('div');
    controls.className = 'cpi-lite-controls';
    controls.innerHTML = `
      <label>BatchSize: <input id="cpi-lite-batch" class="cpi-lite-input" type="number" min="1" step="1" value="${state.batchSize}"></label>
      <button id="cpi-lite-load" class="cpi-lite-btn">Get Message Overview</button>
      <button id="cpi-lite-resender" class="cpi-lite-btn">Resender Interface</button>
      <span id="cpi-lite-status" style="margin-left:8px; color:#666;"></span>
    `;
    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:55%">iFlow</th><th style="width:22%" class="cpi-lite-count">Completed</th><th style="width:23%" class="cpi-lite-count">Failed</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    const fmt = n=> new Intl.NumberFormat().format(n);
    const rowsToRender = Array.isArray(rows) ? rows : [];
    rowsToRender.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    const start = state.pageIndex * state.batchSize;
    const pageRows = rowsToRender.slice(start, start + state.batchSize);
    for (const r of pageRows){
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const tdOk = document.createElement('td');
      const tdFail = document.createElement('td');
      tdName.textContent = r.name || r.symbolicName;
      tdOk.textContent = fmt(r.completed||0);
      const failLink = document.createElement('a');
      failLink.href = '#';
      failLink.className = 'cpi-lite-link cpi-lite-fail';
      failLink.textContent = fmt(r.failed||0);
      failLink.addEventListener('click', (ev)=>{ ev.preventDefault(); showFailedFor(r.symbolicName || r.name, r.name || r.symbolicName); });
      tdFail.appendChild(failLink);
      tdOk.className = 'cpi-lite-count cpi-lite-ok';
      tdFail.className = 'cpi-lite-count';
      tr.appendChild(tdName);
      tr.appendChild(tdOk);
      tr.appendChild(tdFail);
      tbody.appendChild(tr);
    }
    const pager = document.createElement('div');
    pager.className = 'cpi-lite-pager';
    const totalPages = Math.max(1, Math.ceil(rowsToRender.length / state.batchSize));
    pager.innerHTML = `
      <span id="cpi-lite-prev" class="cpi-lite-link">Prev</span>
      <span id="cpi-lite-page">${rowsToRender.length ? state.pageIndex+1 : 0} / ${totalPages}</span>
      <span id="cpi-lite-next" class="cpi-lite-link">Next</span>
    `;
    page.appendChild(header);
    page.appendChild(controls);
    page.appendChild(table);
    page.appendChild(pager);
    root.appendChild(page);
    
    // Update button text based on saved credentials
    updateResenderButtonText();

    // Wire controls
    const batchInput = root.querySelector('#cpi-lite-batch');
    const status = root.querySelector('#cpi-lite-status');
    const prev = root.querySelector('#cpi-lite-prev');
    const next = root.querySelector('#cpi-lite-next');
    prev.onclick = ()=>{ if (state.pageIndex>0){ state.pageIndex--; renderFullPage(state.cachedRows); }};
    next.onclick = ()=>{
      const total = Math.max(1, Math.ceil(rowsToRender.length / state.batchSize));
      if ((state.pageIndex+1) < total){ state.pageIndex++; renderFullPage(state.cachedRows); }
    };
    batchInput.onchange = ()=>{
      const v = Math.max(1, parseInt(batchInput.value,10)||1);
      state.batchSize = v;
      state.pageIndex = 0;
      renderFullPage(state.cachedRows);
    };
    root.querySelector('#cpi-lite-load')?.addEventListener('click', async ()=>{
      status.textContent = 'Loading...';
      try{
        const data = await collect();
        state.cachedRows = Array.isArray(data)? data : [];
        state.pageIndex = 0;
        status.textContent = `Loaded ${state.cachedRows.length} iFlows`;
        renderFullPage(state.cachedRows);
      }catch(e){
        status.textContent = String(e && e.message || e);
      }
    });
    root.querySelector('#cpi-lite-resender')?.addEventListener('click', async ()=>{
      // Show dialog and fetch logs, then show iFlow overview
      showAuthDialogForResender(async (url, username, password, apiUrl)=>{
        status.textContent = 'Fetching failed messages (last 15 mins)...';
        try{
          const data = await fetchMessageProcessingLogs(username, password, apiUrl);
          status.textContent = `Found ${data.iflowSummary.length} iFlows with failed messages`;
          
          // Show iFlow overview screen
          showIflowOverview(data, root);
        }catch(e){
          status.textContent = String(e && e.message || e);
          alert('Failed to fetch logs: ' + String(e && e.message || e));
        }
      });
    });
  }

  function renderFailedPageFull(rows, displayName){
    ensureStyles();
    const container = findMainContentContainer();
    if (!container){ renderInPage([]); return; }
    let root = container.querySelector('#cpi-lite-page-root');
    if (!root){ root = document.createElement('div'); root.id='cpi-lite-page-root'; container.appendChild(root); }
    root.className = isDark() ? 'cpi-lite-dark' : '';
    root.innerHTML = '';

    const page = document.createElement('section');
    page.className = 'cpi-lite-body';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back';
    back.onclick = ()=>{ renderFullPage(state.cachedRows); activateFullPageMode(); };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = `Failed Messages — ${displayName}`;
    header.appendChild(back);
    header.appendChild(title);

    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:30%">Message ID</th><th style="width:12%" class="cpi-lite-count">Status</th><th style="width:58%">Error Details</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    for (const m of rows){
      const tr = document.createElement('tr');
      const tdId = document.createElement('td');
      const tdStatus = document.createElement('td');
      const tdErr = document.createElement('td');
      tdId.textContent = m.messageId || '';
      tdStatus.textContent = m.status || '';
      tdStatus.className = 'cpi-lite-count cpi-lite-fail';
      tdErr.textContent = m.errorDetails || m.errorText || '';
      tr.appendChild(tdId); tr.appendChild(tdStatus); tr.appendChild(tdErr);
      tbody.appendChild(tr);
    }
    page.appendChild(header);
    page.appendChild(table);
    root.appendChild(page);
  }

  function renderFailedPagePanel(rows, displayName){
    ensureStyles();
    const rootId = 'cpi-lite-panel-root';
    let root = document.getElementById(rootId);
    if (!root){ root = document.createElement('div'); root.id=rootId; document.body.appendChild(root); }
    root.className = isDark() ? 'cpi-lite-dark' : '';
    root.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'cpi-lite-panel';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back';
    back.onclick = ()=>{ renderInPage(state.cachedRows); };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = `Failed Messages — ${displayName}`;
    header.appendChild(back);
    header.appendChild(title);
    const body = document.createElement('div');
    body.className = 'cpi-lite-body';
    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:30%">Message ID</th><th style="width:12%" class="cpi-lite-count">Status</th><th style="width:58%">Error Details</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    for (const m of rows){
      const tr = document.createElement('tr');
      const tdId = document.createElement('td');
      const tdStatus = document.createElement('td');
      const tdErr = document.createElement('td');
      tdId.textContent = m.messageId || '';
      tdStatus.textContent = m.status || '';
      tdStatus.className = 'cpi-lite-count cpi-lite-fail';
      tdErr.textContent = m.errorDetails || m.errorText || '';
      tr.appendChild(tdId); tr.appendChild(tdStatus); tr.appendChild(tdErr);
      tbody.appendChild(tr);
    }
    body.appendChild(table);
    panel.appendChild(header);
    panel.appendChild(body);
    root.appendChild(panel);
  }

  async function confirmResend(onConfirm){
    // Get saved credentials for username/password
    const savedData = await safeStorageGet(['resenderUsername', 'resenderPassword']);
    
    if (!savedData.resenderUsername || !savedData.resenderPassword) {
      alert('No saved credentials found. Please configure resender interface first by clicking "Resender Interface" button.');
      return;
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'cpi-lite-dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'cpi-lite-dialog';
    dialog.innerHTML = `
      <h3 style="margin:0 0 16px">Resend Failed Messages</h3>
      <p style="margin:0 0 12px; font-size:13px; color:#666;">The endpoint URL will be automatically discovered for each message based on its iFlow ID.</p>
      <div style="margin-top:8px; font-size:11px; color:#888;">
        <strong>Note:</strong> Saved credentials will be used for authentication
      </div>
      <div class="cpi-lite-dialog-buttons">
        <button class="cpi-lite-btn" id="cpi-lite-resend-cancel">Cancel</button>
        <button class="cpi-lite-btn" id="cpi-lite-resend-confirm">Resend Messages</button>
      </div>
    `;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    const closeDialog = ()=>{
      overlay.remove();
    };
    
    overlay.addEventListener('click', (e)=>{
      if (e.target === overlay) closeDialog();
    });
    
    dialog.querySelector('#cpi-lite-resend-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('#cpi-lite-resend-confirm').addEventListener('click', ()=>{
      closeDialog();
      onConfirm(savedData.resenderUsername, savedData.resenderPassword);
    });
  }

  async function handleOptimizedResend(selectedMessages, resendBtn, root) {
    await confirmResend(async (username, password)=>{
      resendBtn.disabled = true;
      const originalText = resendBtn.textContent;
      
      try{
        // Progress callback to update button text
        const onProgress = (current, total, status) => {
          resendBtn.textContent = `${status} (${current}/${total})`;
        };
        
        const results = await resendMessages(selectedMessages, username, password, onProgress);
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        // Remove successful messages from the display
        successful.forEach(result => {
          const checkbox = root.querySelector(`input[data-message-id="${result.message.id}"]`);
          if (checkbox) {
            const row = checkbox.closest('tr');
            if (row) row.remove();
          }
        });
        
        // Show results
        const successCount = successful.length;
        const failedCount = failed.length;
        
        let message = `Resend completed:\n✅ ${successCount} messages sent successfully`;
        if (failedCount > 0) {
          message += `\n❌ ${failedCount} messages failed`;
          // Show details of failed messages
          const failedDetails = failed.map(r => `• ${r.message.messageGuid || r.message.id}: ${r.error}`).join('\n');
          message += `\n\nFailed messages:\n${failedDetails}`;
        }
        
        // Delete successful entries from data store
        if (successCount > 0) {
          onProgress(0, 0, 'Cleaning up data store...');
          const entryIds = successful.map(r => r.message.entryId).filter(Boolean);
          if (entryIds.length > 0) {
            const deleteResult = await deleteSuccessfulEntries(entryIds, username, password);
            if (deleteResult.success) {
              message += `\n\n🗑️ Deleted ${deleteResult.deleted} entries from data store`;
            } else {
              message += `\n\n⚠️ Failed to delete entries: ${deleteResult.error}`;
            }
          }
        }
        
        alert(message);
        
        // Update select all button if no messages left
        const remainingCheckboxes = root.querySelectorAll('.cpi-lite-checkbox');
        if (remainingCheckboxes.length === 0) {
          const selectAllBtn = root.querySelector('.cpi-lite-select-all');
          if (selectAllBtn) selectAllBtn.style.display = 'none';
          resendBtn.style.display = 'none';
        }
        
      }catch(e){
        alert('Error during resend: ' + (e && e.message || e));
      } finally {
        resendBtn.disabled = false;
        resendBtn.textContent = originalText;
      }
    });
  }

  async function discoverIFlowEndpoint(iFlowId, username, password) {
    try {
      // Determine base URL based on environment
      let baseUrl;
      const isNEO = location.href.includes('/itspaces/');
      
      if (isNEO) {
        // NEO: Use current host
        baseUrl = window.location.protocol + '//' + window.location.host;
      } else {
        // Cloud Foundry: Get API URL from storage
        const savedData = await safeStorageGet(['resenderApiUrl']);
        if (!savedData.resenderApiUrl) {
          throw new Error('API URL not found. Please configure resender interface first.');
        }
        baseUrl = savedData.resenderApiUrl.replace(/\/$/, '');
      }
      
      // Construct ServiceEndpoints API URL with dynamic iFlowId
      const serviceEndpointsUrl = baseUrl + `/api/v1/ServiceEndpoints?$select=EntryPoints/Name,EntryPoints/Url&$expand=EntryPoints&$filter=Name eq '${iFlowId.trim()}'`;
      
      console.log('Discovering endpoint for iFlowId:', iFlowId, 'Environment:', isNEO ? 'NEO' : 'CF', 'URL:', serviceEndpointsUrl);
      
      // Call ServiceEndpoints API - use httpWithAuth to handle cross-origin (CF) and same-origin (NEO)
      const serviceEndpointsXml = await httpWithAuth('GET', serviceEndpointsUrl, username, password, null, 'application/xml');
      
      // Parse XML to extract the endpoint URL
      const parsed = new XmlToJson().parse(serviceEndpointsXml);
      
      // Navigate through XML to find <d:Url>
      const findUrl = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj['d:Url']) return obj['d:Url'];
        if (obj['Url']) return obj['Url'];
        for (const key in obj) {
          const result = findUrl(obj[key]);
          if (result) return result;
        }
        return null;
      };
      
      const endpointUrl = findUrl(parsed);
      
      if (!endpointUrl) {
        throw new Error(`Could not find endpoint URL for iFlow: ${iFlowId}`);
      }
      
      console.log('Discovered endpoint URL:', endpointUrl);
      return endpointUrl;
      
    } catch (error) {
      console.error('Failed to discover endpoint for iFlowId:', iFlowId, error);
      throw new Error(`Failed to discover endpoint for iFlow "${iFlowId}": ${error.message}`);
    }
  }

  function detectAdapterType(endpointUrl) {
    // Detect adapter type from URL pattern
    if (endpointUrl.includes('/cxf/')) {
      return 'SOAP';
    } else if (endpointUrl.includes('/http/')) {
      return 'HTTP';
    }
    // Default to HTTP if pattern not recognized
    return 'HTTP';
  }

  function cleanPayloadNamespaces(payload) {
    // Remove xmlns:soap namespace declarations from the payload
    // This handles various formats of the namespace declaration
    let cleanedPayload = payload;
    
    // Case 1: Remove xmlns:soap as an attribute
    // Example: <Order xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    cleanedPayload = cleanedPayload.replace(/\s*xmlns:soap\s*=\s*["']http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/["']/gi, '');
    cleanedPayload = cleanedPayload.replace(/\s*xmlns:soapenv\s*=\s*["']http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/["']/gi, '');
    
    // Case 2: Remove xmlns:soap as a child element (when XML parser converts it)
    // Example: <xmlns:soap>http://schemas.xmlsoap.org/soap/envelope/</xmlns:soap>
    cleanedPayload = cleanedPayload.replace(/<xmlns:soap>http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/<\/xmlns:soap>/gi, '');
    cleanedPayload = cleanedPayload.replace(/<xmlns:soapenv>http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/<\/xmlns:soapenv>/gi, '');
    
    // Case 3: Remove any whitespace/newlines left behind
    cleanedPayload = cleanedPayload.replace(/>\s+</g, '><');
    
    console.log('Original payload:', payload);
    console.log('Cleaned payload (removed SOAP namespaces):', cleanedPayload);
    return cleanedPayload;
  }

  function wrapInSoapEnvelope(payload) {
    // Clean the payload first (remove any SOAP namespace declarations)
    const cleanedPayload = cleanPayloadNamespaces(payload);
    
    // Wrap the cleaned payload in a SOAP envelope
    const soapEnvelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header/>
  <soapenv:Body>
${cleanedPayload}
  </soapenv:Body>
</soapenv:Envelope>`;
    return soapEnvelope;
  }

  async function resendMessages(selectedMessages, username, password, onProgress){
    const results = [];
    const total = selectedMessages.length;
    
    console.log(`Starting resend of ${total} messages`);
    
    // For Cloud Foundry, get Client ID/Secret for iFlow calls
    const isNEO = location.href.includes('/itspaces/');
    let iflowUsername = username;
    let iflowPassword = password;
    
    if (!isNEO) {
      // Cloud Foundry: Use Client ID/Secret for iFlow calls
      const savedData = await safeStorageGet(['resenderClientId', 'resenderClientSecret']);
      if (savedData.resenderClientId && savedData.resenderClientSecret) {
        iflowUsername = savedData.resenderClientId;
        iflowPassword = savedData.resenderClientSecret;
        console.log('Cloud Foundry: Using Client ID/Secret for iFlow calls');
      } else {
        console.warn('Cloud Foundry: Client ID/Secret not found, using username/password');
      }
    }
    
    // Process messages in batches to avoid overwhelming the server
    const batchSize = 3;
    for (let i = 0; i < selectedMessages.length; i += batchSize) {
      const batch = selectedMessages.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (msg, index) => {
        const overallIndex = i + index;
        try {
          // Update progress
          if (onProgress) {
            onProgress(overallIndex + 1, total, `Discovering endpoint for message ${overallIndex + 1}/${total}...`);
          }
          
          // Discover the endpoint URL for this iFlow
          const iFlowId = msg.iFlowId;
          if (!iFlowId) {
            throw new Error('Message does not have an iFlowId');
          }
          
          const targetUrl = await discoverIFlowEndpoint(iFlowId, username, password);
          console.log(`Message ${overallIndex + 1} will be sent to:`, targetUrl);
          
          // Detect adapter type
          const adapterType = detectAdapterType(targetUrl);
          console.log(`Message ${overallIndex + 1} adapter type:`, adapterType);
          
          // Update progress
          if (onProgress) {
            onProgress(overallIndex + 1, total, `Resending message ${overallIndex + 1}/${total}... (${adapterType})`);
          }
          
          // Extract payload content (remove <payload> wrapper)
          let payloadContent = extractPayloadContent(msg);
          console.log(`Message ${overallIndex + 1} original payload:`, payloadContent);
          
          // Prepare request based on adapter type
          let finalPayload;
          let contentType;
          
          if (adapterType === 'SOAP') {
            // For SOAP adapter: wrap payload in SOAP envelope
            finalPayload = wrapInSoapEnvelope(payloadContent);
            contentType = 'text/xml; charset=utf-8';
            console.log(`Message ${overallIndex + 1} wrapped in SOAP envelope:`, finalPayload);
          } else {
            // For HTTP adapter: use payload as-is
            finalPayload = payloadContent;
            contentType = 'application/xml';
            console.log(`Message ${overallIndex + 1} using HTTP adapter (no wrapping)`);
          }
          
          // Send POST request with appropriate content type (use iFlow credentials)
          const response = await httpWithAuth('POST', targetUrl, iflowUsername, iflowPassword, finalPayload, contentType);
          
          console.log(`Message ${overallIndex + 1} sent successfully:`, response);
          return { 
            message: msg, 
            success: true, 
            response: response,
            index: overallIndex
          };
          
        } catch(e) {
          console.error(`Message ${overallIndex + 1} failed:`, e);
          return { 
            message: msg, 
            success: false, 
            error: String(e && e.message || e),
            index: overallIndex
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to be nice to the server
      if (i + batchSize < selectedMessages.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Sort results by original index to maintain order
    results.sort((a, b) => a.index - b.index);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`Resend completed: ${successful} successful, ${failed} failed`);
    
    return results;
  }

  async function deleteSuccessfulEntries(entryIds, username, password) {
    try {
      if (!entryIds || entryIds.length === 0) {
        console.log('No entries to delete');
        return { success: true, deleted: 0 };
      }

      console.log(`Deleting ${entryIds.length} entries from data store:`, entryIds);

      // Step 1: Determine base URL based on environment
      let baseUrl;
      const isNEO = location.href.includes('/itspaces/');
      
      if (isNEO) {
        // NEO: Use current host
        baseUrl = window.location.protocol + '//' + window.location.host;
      } else {
        // Cloud Foundry: Get API URL from storage
        const savedData = await safeStorageGet(['resenderApiUrl']);
        if (!savedData.resenderApiUrl) {
          throw new Error('API URL not found. Please configure resender interface first.');
        }
        baseUrl = savedData.resenderApiUrl.replace(/\/$/, '');
      }
      
      // Discover the delete endpoint URL
      const serviceEndpointsUrl = baseUrl + "/api/v1/ServiceEndpoints?$select=EntryPoints/Name,EntryPoints/Url&$expand=EntryPoints&$filter=Name eq 'Delete_Global_DataStore'";
      
      console.log('Discovering delete endpoint from:', serviceEndpointsUrl, 'Environment:', isNEO ? 'NEO' : 'CF');
      
      // Call ServiceEndpoints API - use httpWithAuth to handle cross-origin (CF) and same-origin (NEO)
      const serviceEndpointsXml = await httpWithAuth('GET', serviceEndpointsUrl, username, password, null, 'application/xml');
      const parsed = new XmlToJson().parse(serviceEndpointsXml);
      
      // Extract URL
      const findUrl = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj['d:Url']) return obj['d:Url'];
        if (obj['Url']) return obj['Url'];
        for (const key in obj) {
          const result = findUrl(obj[key]);
          if (result) return result;
        }
        return null;
      };
      
      const deleteUrl = findUrl(parsed);
      
      if (!deleteUrl) {
        throw new Error('Could not find delete endpoint URL for Delete_Global_DataStore');
      }
      
      console.log('Delete endpoint URL:', deleteUrl);

      // Step 2: Determine credentials for delete call
      let deleteUsername = username;
      let deletePassword = password;
      
      if (!isNEO) {
        // Cloud Foundry: Use Client ID/Secret for iFlow calls
        const savedData = await safeStorageGet(['resenderClientId', 'resenderClientSecret']);
        if (savedData.resenderClientId && savedData.resenderClientSecret) {
          deleteUsername = savedData.resenderClientId;
          deletePassword = savedData.resenderClientSecret;
          console.log('Cloud Foundry: Using Client ID/Secret for delete call');
        }
      }
      
      // Send entry IDs to delete endpoint
      const entryIdsXml = entryIds.map(id => `<EntryID>${id}</EntryID>`).join('');
      const deletePayload = `<EntryIDs>${entryIdsXml}</EntryIDs>`;
      
      console.log('Sending delete request with payload:', deletePayload);
      
      const response = await httpWithAuth('POST', deleteUrl, deleteUsername, deletePassword, deletePayload, 'application/xml');
      
      console.log('Delete response:', response);
      
      return { success: true, deleted: entryIds.length, response };
      
    } catch (error) {
      console.error('Failed to delete entries:', error);
      return { success: false, error: error.message };
    }
  }

  function extractPayloadContent(message) {
    try {
      const payload = message.payload || {};
      console.log('Extracting payload from message:', message);
      
      // If payload is already a string (XML), extract content from <payload> tags
      if (typeof payload === 'string') {
        const payloadMatch = payload.match(/<payload>(.*?)<\/payload>/s);
        if (payloadMatch) {
          return payloadMatch[1].trim();
        }
        // If no <payload> wrapper, return as-is
        return payload;
      }
      
      // If payload is an object, serialize it to XML (excluding the payload wrapper)
      if (typeof payload === 'object' && payload !== null) {
        return serializePayloadContent(payload);
      }
      
      // Fallback: return empty content
      console.warn('No valid payload found in message:', message);
      return '';
      
    } catch (e) {
      console.error('Error extracting payload content:', e);
      return '';
    }
  }

  function serializePayloadContent(payload, indent = '') {
    if (!payload || typeof payload !== 'object') return String(payload || '');
    
    let xml = '';
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'payload') continue; // Skip the payload wrapper itself
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        xml += `${indent}<${key}>${serializePayloadContent(value, indent + '  ')}</${key}>\n`;
      } else if (Array.isArray(value)) {
        for (const item of value) {
          xml += `${indent}<${key}>${serializePayloadContent(item, indent + '  ')}</${key}>\n`;
        }
      } else {
        xml += `${indent}<${key}>${escapeXml(String(value))}</${key}>\n`;
      }
    }
    return xml.trim();
  }

  function escapeXml(text){
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function serializePayload(payload, indent = '  '){
    if (!payload || typeof payload !== 'object') return '';
    let xml = '';
    for (const [key, value] of Object.entries(payload)){
      if (value && typeof value === 'object' && !Array.isArray(value)){
        xml += `\n${indent}<${key}>${serializePayload(value, indent + '  ')}\n${indent}</${key}>`;
      } else if (Array.isArray(value)){
        for (const item of value){
          xml += `\n${indent}<${key}>${serializePayload(item, indent + '  ')}\n${indent}</${key}>`;
        }
      } else {
        xml += `\n${indent}<${key}>${escapeXml(String(value))}</${key}>`;
      }
    }
    return xml;
  }

  function renderResenderOverviewPagePanel(iflowSummary, credentials){
    ensureStyles();
    const rootId = 'cpi-lite-panel-root';
    let root = document.getElementById(rootId);
    if (!root){ root = document.createElement('div'); root.id=rootId; document.body.appendChild(root); }
    root.className = isDark() ? 'cpi-lite-dark' : '';
    root.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'cpi-lite-panel';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back';
    back.onclick = ()=>{ renderInPage(state.cachedRows); };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = 'Resender Interface - Overview';
    header.appendChild(back);
    header.appendChild(title);
    
    const body = document.createElement('div');
    body.className = 'cpi-lite-body';

    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:50%">iFlow Name</th><th style="width:20%" class="cpi-lite-count">Total Messages</th><th style="width:15%" class="cpi-lite-count">Completed</th><th style="width:15%" class="cpi-lite-count">Failed</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    const fmt = n=> new Intl.NumberFormat().format(n);
    
    for (const iflow of iflowSummary){
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const tdTotal = document.createElement('td');
      const tdCompleted = document.createElement('td');
      const tdFailed = document.createElement('td');
      
      tdName.textContent = iflow.name;
      tdTotal.textContent = fmt(iflow.total);
      tdCompleted.textContent = fmt(iflow.completed);
      
      // Make failed count clickable if there are failed messages
      if (iflow.failed > 0) {
        const failLink = document.createElement('a');
        failLink.href = '#';
        failLink.className = 'cpi-lite-link cpi-lite-fail';
        failLink.textContent = fmt(iflow.failed);
        failLink.addEventListener('click', (ev)=>{ 
          ev.preventDefault(); 
          const failedMessages = iflow.messages.filter(m => m.status && m.status.trim().toUpperCase() === 'FAILED');
          renderResenderPagePanel(failedMessages, iflow.name, credentials);
        });
        tdFailed.appendChild(failLink);
      } else {
        tdFailed.textContent = fmt(iflow.failed);
        tdFailed.className = 'cpi-lite-count';
      }
      
      tdTotal.className = 'cpi-lite-count';
      tdCompleted.className = 'cpi-lite-count cpi-lite-ok';
      if (iflow.failed === 0) {
        tdFailed.className += ' cpi-lite-ok';
      }
      
      tr.appendChild(tdName);
      tr.appendChild(tdTotal);
      tr.appendChild(tdCompleted);
      tr.appendChild(tdFailed);
      tbody.appendChild(tr);
    }

    body.appendChild(table);
    panel.appendChild(header);
    panel.appendChild(body);
    root.appendChild(panel);
  }

  function renderResenderOverviewPageFull(iflowSummary, credentials){
    console.log('Rendering resender overview with data:', iflowSummary);
    ensureStyles();
    const container = findMainContentContainer();
    if (!container){ renderInPage([]); return; }
    let root = container.querySelector('#cpi-lite-page-root');
    if (!root){ root = document.createElement('div'); root.id='cpi-lite-page-root'; container.appendChild(root); }
    root.className = isDark() ? 'cpi-lite-dark' : '';
    root.innerHTML = '';

    const page = document.createElement('section');
    page.className = 'cpi-lite-body';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back';
    back.onclick = ()=>{ renderFullPage(state.cachedRows); activateFullPageMode(); };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = 'Resender Interface - Overview';
    header.appendChild(back);
    header.appendChild(title);

    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:50%">iFlow Name</th><th style="width:20%" class="cpi-lite-count">Total Messages</th><th style="width:15%" class="cpi-lite-count">Completed</th><th style="width:15%" class="cpi-lite-count">Failed</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    const fmt = n=> new Intl.NumberFormat().format(n);
    
    for (const iflow of iflowSummary){
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const tdTotal = document.createElement('td');
      const tdCompleted = document.createElement('td');
      const tdFailed = document.createElement('td');
      
      tdName.textContent = iflow.name;
      tdTotal.textContent = fmt(iflow.total);
      tdCompleted.textContent = fmt(iflow.completed);
      
      // Make failed count clickable if there are failed messages
      if (iflow.failed > 0) {
        const failLink = document.createElement('a');
        failLink.href = '#';
        failLink.className = 'cpi-lite-link cpi-lite-fail';
        failLink.textContent = fmt(iflow.failed);
        failLink.addEventListener('click', (ev)=>{ 
          ev.preventDefault(); 
          const failedMessages = iflow.messages.filter(m => m.status && m.status.trim().toUpperCase() === 'FAILED');
          renderResenderPageFull(failedMessages, iflow.name, credentials);
        });
        tdFailed.appendChild(failLink);
      } else {
        tdFailed.textContent = fmt(iflow.failed);
        tdFailed.className = 'cpi-lite-count';
      }
      
      tdTotal.className = 'cpi-lite-count';
      tdCompleted.className = 'cpi-lite-count cpi-lite-ok';
      if (iflow.failed === 0) {
        tdFailed.className += ' cpi-lite-ok';
      }
      
      tr.appendChild(tdName);
      tr.appendChild(tdTotal);
      tr.appendChild(tdCompleted);
      tr.appendChild(tdFailed);
      tbody.appendChild(tr);
    }

    page.appendChild(header);
    page.appendChild(table);
    root.appendChild(page);
  }

  function renderResenderPageFull(messages, iflowName, credentials){
    ensureStyles();
    const container = findMainContentContainer();
    if (!container){ renderInPage([]); return; }
    let root = container.querySelector('#cpi-lite-page-root');
    if (!root){ root = document.createElement('div'); root.id='cpi-lite-page-root'; container.appendChild(root); }
    root.className = isDark() ? 'cpi-lite-dark' : '';
    root.innerHTML = '';

    const page = document.createElement('section');
    page.className = 'cpi-lite-body';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back to Overview';
    back.onclick = async ()=>{ 
      // Go back to overview page
      try {
        const iflowSummary = await fetchResenderOverview(credentials.resenderUrl, credentials.resenderUsername, credentials.resenderPassword);
        renderResenderOverviewPageFull(iflowSummary, credentials);
        activateFullPageMode();
      } catch(e) {
        renderFullPage(state.cachedRows); 
        activateFullPageMode();
      }
    };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = `Resender Interface - ${iflowName || 'Failed Messages'}`;
    header.appendChild(back);
    header.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'cpi-lite-controls';
    controls.style.marginBottom = '12px';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'cpi-lite-select-all';
    selectAllBtn.textContent = 'Select All';
    const resendBtn = document.createElement('button');
    resendBtn.className = 'cpi-lite-btn';
    resendBtn.id = 'cpi-lite-resend-btn';
    resendBtn.textContent = 'Resend Failed Messages';
    resendBtn.style.marginLeft = '8px';
    controls.appendChild(selectAllBtn);
    controls.appendChild(resendBtn);

    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:4%"></th><th style="width:20%">Entry ID</th><th style="width:20%">Message GUID</th><th style="width:16%">iFlow ID</th><th style="width:20%">iFlow Name</th><th style="width:20%">Status</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    
    for (const msg of messages){
      const tr = document.createElement('tr');
      const tdCheckbox = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'cpi-lite-checkbox';
      checkbox.dataset.messageId = msg.id;
      tdCheckbox.appendChild(checkbox);
      
      const tdEntryId = document.createElement('td');
      tdEntryId.textContent = msg.entryId || '';
      tdEntryId.style.fontSize = '11px';
      const tdGuid = document.createElement('td');
      tdGuid.textContent = msg.messageGuid || '';
      tdGuid.style.fontSize = '11px';
      const tdIFlowId = document.createElement('td');
      tdIFlowId.textContent = msg.iFlowId || '';
      const tdName = document.createElement('td');
      tdName.textContent = msg.iFlowName || '';
      const tdStatus = document.createElement('td');
      tdStatus.textContent = msg.status || '';
      if (msg.status && msg.status.trim().toUpperCase() === 'FAILED'){
        tdStatus.className = 'cpi-lite-fail';
      }
      
      tr.appendChild(tdCheckbox);
      tr.appendChild(tdEntryId);
      tr.appendChild(tdGuid);
      tr.appendChild(tdIFlowId);
      tr.appendChild(tdName);
      tr.appendChild(tdStatus);
      tbody.appendChild(tr);
    }

    page.appendChild(header);
    page.appendChild(controls);
    page.appendChild(table);
    root.appendChild(page);

    selectAllBtn.onclick = ()=>{
      const checkboxes = root.querySelectorAll('.cpi-lite-checkbox');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
      selectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
    };

    resendBtn.addEventListener('click', ()=>{
      const selected = Array.from(root.querySelectorAll('.cpi-lite-checkbox:checked'))
        .map(cb => messages.find(m => m.id === cb.dataset.messageId))
        .filter(Boolean);
      if (selected.length === 0){
        alert('Please select at least one message');
        return;
      }
      confirmResend(async (username, password)=>{
        resendBtn.disabled = true;
        const originalText = resendBtn.textContent;
        try{
          const onProgress = (current, total, status) => {
            resendBtn.textContent = status || `Processing ${current}/${total}...`;
          };
          
          const results = await resendMessages(selected, username, password, onProgress);
          const successful = results.filter(r => r.success);
          const failed = results.filter(r => !r.success);
          
          let message = `Resend completed:
✅ ${successful.length} succeeded`;
          if (failed.length > 0) {
            message += `
❌ ${failed.length} failed`;
          }
          
          // Delete successful entries from data store and refresh
          if (successful.length > 0) {
            resendBtn.textContent = 'Cleaning up data store...';
            const entryIds = successful.map(r => r.message.entryId).filter(Boolean);
            if (entryIds.length > 0) {
              const deleteResult = await deleteSuccessfulEntries(entryIds, username, password);
              if (deleteResult.success) {
                message += `
🗑️ Deleted ${deleteResult.deleted} entries`;
              }
            }
            
            // Refresh data
            resendBtn.textContent = 'Refreshing data...';
            try {
              const iflowSummary = await fetchResenderOverview(username, password);
              const failedMessages = iflowSummary
                .find(iflow => iflow.name === iflowName)?.messages
                .filter(m => m.status && m.status.trim().toUpperCase() === 'FAILED') || [];
              
              if (failedMessages.length > 0) {
                renderResenderPageFull(failedMessages, iflowName, credentials);
                message += `

🔄 Refreshed - ${failedMessages.length} remaining`;
              } else {
                renderResenderOverviewPageFull(iflowSummary, credentials);
                activateFullPageMode();
                message += `

✅ All done! Returning to overview.`;
              }
            } catch(e) {
              message += `
⚠️ Refresh failed: ${e.message}`;
            }
          }
          
          alert(message);
        }catch(e){
          alert('Error: ' + (e && e.message || e));
        } finally {
          resendBtn.disabled = false;
          resendBtn.textContent = originalText;
        }
      });
    });
  }

  function renderResenderSummaryPageFull(iflowSummary){
    ensureStyles();
    const container = findMainContentContainer();
    if (!container){ renderInPage([]); return; }
    let root = container.querySelector('#cpi-lite-page-root');
    if (!root){ root = document.createElement('div'); root.id='cpi-lite-page-root'; container.appendChild(root); }
    root.className = isDark() ? 'cpi-lite-dark' : '';
    root.innerHTML = '';

    const page = document.createElement('section');
    page.className = 'cpi-lite-body';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back';
    back.onclick = ()=>{ renderFullPage(state.cachedRows); activateFullPageMode(); };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = 'Resender Interface';
    header.appendChild(back);
    header.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'cpi-lite-controls';
    controls.style.marginBottom = '12px';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'cpi-lite-select-all';
    selectAllBtn.textContent = 'Select All';
    const resendBtn = document.createElement('button');
    resendBtn.className = 'cpi-lite-btn';
    resendBtn.id = 'cpi-lite-resend-btn';
    resendBtn.textContent = 'Resend Failed Messages';
    resendBtn.style.marginLeft = '8px';
    controls.appendChild(selectAllBtn);
    controls.appendChild(resendBtn);

    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:4%"></th><th style="width:20%">Entry ID</th><th style="width:20%">Message GUID</th><th style="width:16%">iFlow ID</th><th style="width:20%">iFlow Name</th><th style="width:20%">Status</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    
    for (const msg of messages){
      const tr = document.createElement('tr');
      const tdCheckbox = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'cpi-lite-checkbox';
      checkbox.dataset.messageId = msg.id;
      tdCheckbox.appendChild(checkbox);
      
      const tdEntryId = document.createElement('td');
      tdEntryId.textContent = msg.entryId || '';
      tdEntryId.style.fontSize = '11px';
      const tdGuid = document.createElement('td');
      tdGuid.textContent = msg.messageGuid || '';
      tdGuid.style.fontSize = '11px';
      const tdIFlowId = document.createElement('td');
      tdIFlowId.textContent = msg.iFlowId || '';
      const tdName = document.createElement('td');
      tdName.textContent = msg.iFlowName || '';
      const tdStatus = document.createElement('td');
      tdStatus.textContent = msg.status || '';
      if (msg.status && msg.status.trim().toUpperCase() === 'FAILED'){
        tdStatus.className = 'cpi-lite-fail';
      }
      
      tr.appendChild(tdCheckbox);
      tr.appendChild(tdEntryId);
      tr.appendChild(tdGuid);
      tr.appendChild(tdIFlowId);
      tr.appendChild(tdName);
      tr.appendChild(tdStatus);
      tbody.appendChild(tr);
    }

    page.appendChild(header);
    page.appendChild(controls);
    page.appendChild(table);
    root.appendChild(page);

    selectAllBtn.onclick = ()=>{
      const checkboxes = root.querySelectorAll('.cpi-lite-checkbox');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
      selectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
    };

    resendBtn.addEventListener('click', ()=>{
      const selected = Array.from(root.querySelectorAll('.cpi-lite-checkbox:checked'))
        .map(cb => messages.find(m => m.id === cb.dataset.messageId))
        .filter(Boolean);
      if (selected.length === 0){
        alert('Please select at least one message');
        return;
      }
      confirmResend(async (username, password)=>{
        resendBtn.disabled = true;
        const originalText = resendBtn.textContent;
        try{
          const onProgress = (current, total, status) => {
            resendBtn.textContent = status || `Processing ${current}/${total}...`;
          };
          
          const results = await resendMessages(selected, username, password, onProgress);
          const successful = results.filter(r => r.success);
          const failed = results.filter(r => !r.success);
          
          let message = `Resend completed:
✅ ${successful.length} succeeded`;
          if (failed.length > 0) {
            message += `
❌ ${failed.length} failed`;
          }
          
          // Delete successful entries from data store and refresh
          if (successful.length > 0) {
            resendBtn.textContent = 'Cleaning up data store...';
            const entryIds = successful.map(r => r.message.entryId).filter(Boolean);
            if (entryIds.length > 0) {
              const deleteResult = await deleteSuccessfulEntries(entryIds, username, password);
              if (deleteResult.success) {
                message += `
🗑️ Deleted ${deleteResult.deleted} entries`;
              }
            }
            
            // Refresh data
            resendBtn.textContent = 'Refreshing data...';
            try {
              const iflowSummary = await fetchResenderOverview(username, password);
              const failedMessages = iflowSummary
                .find(iflow => iflow.name === iflowName)?.messages
                .filter(m => m.status && m.status.trim().toUpperCase() === 'FAILED') || [];
              
              if (failedMessages.length > 0) {
                renderResenderPageFull(failedMessages, iflowName, credentials);
                message += `

🔄 Refreshed - ${failedMessages.length} remaining`;
              } else {
                renderResenderOverviewPageFull(iflowSummary, credentials);
                activateFullPageMode();
                message += `

✅ All done! Returning to overview.`;
              }
            } catch(e) {
              message += `
⚠️ Refresh failed: ${e.message}`;
            }
          }
          
          alert(message);
        }catch(e){
          alert('Error: ' + (e && e.message || e));
        } finally {
          resendBtn.disabled = false;
          resendBtn.textContent = originalText;
        }
      });
    });
  }

  function renderResenderPagePanel(messages, iflowName, credentials){
    ensureStyles();
    const rootId = 'cpi-lite-panel-root';
    let root = document.getElementById(rootId);
    if (!root){ root = document.createElement('div'); root.id=rootId; document.body.appendChild(root); }
    root.className = isDark() ? 'cpi-lite-dark' : '';
    root.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'cpi-lite-panel';
    const header = document.createElement('div');
    header.className = 'cpi-lite-header';
    const back = document.createElement('button');
    back.className = 'cpi-lite-back';
    back.textContent = '← Back';
    back.onclick = async ()=>{ 
      // Go back to overview page
      try {
        const iflowSummary = await fetchResenderOverview(credentials.resenderUrl, credentials.resenderUsername, credentials.resenderPassword);
        renderResenderOverviewPagePanel(iflowSummary, credentials);
      } catch(e) {
        renderInPage(state.cachedRows);
      }
    };
    const title = document.createElement('div');
    title.className = 'cpi-lite-title';
    title.textContent = `Resender Interface - ${iflowName || 'Failed Messages'}`;
    header.appendChild(back);
    header.appendChild(title);
    
    const body = document.createElement('div');
    body.className = 'cpi-lite-body';
    
    const controls = document.createElement('div');
    controls.className = 'cpi-lite-controls';
    controls.style.marginBottom = '12px';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'cpi-lite-select-all';
    selectAllBtn.textContent = 'Select All';
    const resendBtn = document.createElement('button');
    resendBtn.className = 'cpi-lite-btn';
    resendBtn.id = 'cpi-lite-resend-btn';
    resendBtn.textContent = 'Resend Failed Messages';
    resendBtn.style.marginLeft = '8px';
    controls.appendChild(selectAllBtn);
    controls.appendChild(resendBtn);

    const table = document.createElement('table');
    table.className = 'cpi-lite-table';
    table.innerHTML = '<thead><tr><th style="width:4%"></th><th style="width:20%">Entry ID</th><th style="width:20%">Message GUID</th><th style="width:16%">iFlow ID</th><th style="width:20%">iFlow Name</th><th style="width:20%">Status</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    
    for (const msg of messages){
      const tr = document.createElement('tr');
      const tdCheckbox = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'cpi-lite-checkbox';
      checkbox.dataset.messageId = msg.id;
      tdCheckbox.appendChild(checkbox);
      
      const tdEntryId = document.createElement('td');
      tdEntryId.textContent = msg.entryId || '';
      tdEntryId.style.fontSize = '11px';
      const tdGuid = document.createElement('td');
      tdGuid.textContent = msg.messageGuid || '';
      tdGuid.style.fontSize = '11px';
      const tdIFlowId = document.createElement('td');
      tdIFlowId.textContent = msg.iFlowId || '';
      const tdName = document.createElement('td');
      tdName.textContent = msg.iFlowName || '';
      const tdStatus = document.createElement('td');
      tdStatus.textContent = msg.status || '';
      if (msg.status && msg.status.trim().toUpperCase() === 'FAILED'){
        tdStatus.className = 'cpi-lite-fail';
      }
      
      tr.appendChild(tdCheckbox);
      tr.appendChild(tdEntryId);
      tr.appendChild(tdGuid);
      tr.appendChild(tdIFlowId);
      tr.appendChild(tdName);
      tr.appendChild(tdStatus);
      tbody.appendChild(tr);
    }

    body.appendChild(controls);
    body.appendChild(table);
    panel.appendChild(header);
    panel.appendChild(body);
    root.appendChild(panel);

    selectAllBtn.onclick = ()=>{
      const checkboxes = root.querySelectorAll('.cpi-lite-checkbox');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
      selectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
    };

    resendBtn.addEventListener('click', ()=>{
      const selected = Array.from(root.querySelectorAll('.cpi-lite-checkbox:checked'))
        .map(cb => messages.find(m => m.id === cb.dataset.messageId))
        .filter(Boolean);
      if (selected.length === 0){
        alert('Please select at least one message');
        return;
      }
      confirmResend(async (username, password)=>{
        resendBtn.disabled = true;
        const originalText = resendBtn.textContent;
        try{
          const onProgress = (current, total, status) => {
            resendBtn.textContent = status || `Processing ${current}/${total}...`;
          };
          
          const results = await resendMessages(selected, username, password, onProgress);
          const successful = results.filter(r => r.success);
          const failed = results.filter(r => !r.success);
          
          let message = `Resend completed:
✅ ${successful.length} succeeded`;
          if (failed.length > 0) {
            message += `
❌ ${failed.length} failed`;
          }
          
          // Delete successful entries from data store and refresh
          if (successful.length > 0) {
            resendBtn.textContent = 'Cleaning up data store...';
            const entryIds = successful.map(r => r.message.entryId).filter(Boolean);
            if (entryIds.length > 0) {
              const deleteResult = await deleteSuccessfulEntries(entryIds, username, password);
              if (deleteResult.success) {
                message += `
🗑️ Deleted ${deleteResult.deleted} entries`;
              }
            }
            
            // Refresh data
            resendBtn.textContent = 'Refreshing data...';
            try {
              const iflowSummary = await fetchResenderOverview(username, password);
              const failedMessages = iflowSummary
                .find(iflow => iflow.name === iflowName)?.messages
                .filter(m => m.status && m.status.trim().toUpperCase() === 'FAILED') || [];
              
              if (failedMessages.length > 0) {
                renderResenderPageFull(failedMessages, iflowName, credentials);
                message += `

🔄 Refreshed - ${failedMessages.length} remaining`;
              } else {
                renderResenderOverviewPageFull(iflowSummary, credentials);
                activateFullPageMode();
                message += `

✅ All done! Returning to overview.`;
              }
            } catch(e) {
              message += `
⚠️ Refresh failed: ${e.message}`;
            }
          }
          
          alert(message);
        }catch(e){
          alert('Error: ' + (e && e.message || e));
        } finally {
          resendBtn.disabled = false;
          resendBtn.textContent = originalText;
        }
      });
    });
  }

  async function showFailedFor(symbolicName, displayName){
    const main = findMainContentContainer();
    try{
      if (main){
        renderFailedPageFull([], displayName);
        activateFullPageMode();
        const list = await listFailedMessagesForIflow(symbolicName, 500);
        renderFailedPageFull(list, displayName);
        activateFullPageMode();
      } else {
        renderFailedPagePanel([], displayName);
        const list = await listFailedMessagesForIflow(symbolicName, 500);
        renderFailedPagePanel(list, displayName);
      }
    }catch(e){
      const errRow = [{ messageId:'', status:'FAILED', errorText: String(e && e.message || e) }];
      if (main){ renderFailedPageFull(errRow, displayName); activateFullPageMode(); }
      else { renderFailedPagePanel(errRow, displayName); }
    }
  }

  function findSplitDetailContainer(){
    // Preferred host content area where Sprintegrate injects
    const detail = document.querySelector('#shell--splitApp-Detail');
    if (detail) return detail;
    const mainCont = document.querySelector('#mainPage-cont');
    return mainCont ? mainCont : null;
  }

  function activateFullPageMode(){
    const detail = findSplitDetailContainer();
    if (!detail) return false;
    // Hide all other top-level children while our page is active
    Array.from(detail.children).forEach((child)=>{
      if (child.id !== 'cpi-lite-page-root') child.classList.add('cpi-lite-hidden');
    });
    return true;
  }

  function deactivateFullPageMode(){
    const detail = findSplitDetailContainer();
    if (!detail) return;
    Array.from(detail.children).forEach((child)=> child.classList.remove('cpi-lite-hidden'));
    const root = document.getElementById('cpi-lite-page-root');
    if (root) root.remove();
  }

  async function openInPage(){
    try{
      const main = findMainContentContainer();
      if (main){
        // Remove any existing floating panel when switching to full-page embed
        const floatRoot = document.getElementById('cpi-lite-panel-root');
        if (floatRoot) floatRoot.remove();
        // Initial skeleton while data loads
        state.cachedRows = [];
        state.pageIndex = 0;
        renderFullPage([]);
        activateFullPageMode();
        // Wait for user to click 'Get Message Overview'
      } else {
        // Fallback: show floating right-side panel
        state.cachedRows = [];
        state.pageIndex = 0;
        renderInPage([]);
      }
    }catch(e){
      // In case of error, still show panel with message
      ensureStyles();
      const rootId = 'cpi-lite-panel-root';
      let root = document.getElementById(rootId);
      if (!root){ root = document.createElement('div'); root.id=rootId; document.body.appendChild(root); }
      root.innerHTML = `<div class="cpi-lite-panel"><div class="cpi-lite-header"><div class="cpi-lite-title">CPI Helper Lite</div><button class="cpi-lite-close" aria-label="Close">✕</button></div><div class="cpi-lite-body"><div style="color:#c53030">${String(e && e.message || e)}</div></div></div>`;
      root.querySelector('.cpi-lite-close')?.addEventListener('click', ()=>root.remove());
    }
  }

  function findSideNavContainer(){
    const candidates = [
      document.querySelector('#shell--sideNavigation nav ul'),
      document.querySelector('#shell--sideNavigation [role="menu"]'),
      document.querySelector('#shell--sideNavigation'),
      document.querySelector('[id$="--sideNavigation"] [role="menu"]'),
      document.querySelector('[id$="--sideNavigation"]'),
      document.querySelector('.sapTntSideNavigation [role="menu"]'),
      document.querySelector('.sapTntSideNavigation')
    ];
    return candidates.find(Boolean) || null;
  }

  function injectLeftNavButton(){
    const parent = findSideNavContainer();
    if (!parent) return false;
    if (document.getElementById('cpi-lite-nav-item')) return true;

    const item = document.createElement('div');
    item.id = 'cpi-lite-nav-item';
    item.className = 'cpi-lite-nav-btn';
    const icon = document.createElement('img');
    icon.alt = '';
    icon.width = 16; icon.height = 16;
    icon.src = chrome.runtime.getURL('images/v4/16.png');
    const text = document.createElement('span');
    text.textContent = 'CPI Helper Lite';
    item.appendChild(icon);
    item.appendChild(text);
    item.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); openInPage(); });

    // Deactivate our page when another side-nav item is clicked
    parent.addEventListener('click', (e)=>{
      if (!item.contains(e.target)){
        deactivateFullPageMode();
      }
    });

    // Try to append in a reasonable place: after first group of items
    try{ parent.appendChild(item); }
    catch(_e){ document.body.appendChild(item); }
    return true;
  }

  // attempt injection repeatedly until it succeeds
  function boot(){
    ensureStyles();
    let attempts = 0;
    const timer = setInterval(()=>{
      attempts++;
      if (injectLeftNavButton()){ 
        clearInterval(timer);
        // Update button text after successful injection
        setTimeout(updateResenderButtonText, 500);
      }
      if (attempts>180){ clearInterval(timer); } // stop after ~3 minutes
    }, 1000);

    // Also observe for theme changes to update dark mode styling
    const obs = new MutationObserver(()=>{
      const root = document.getElementById('cpi-lite-panel-root');
      if (root){ root.className = isDark() ? 'cpi-lite-dark' : ''; }
    });
    obs.observe(document.documentElement, { attributes:true, attributeFilter:['class'] });

    // Hide our page on URL/navigation changes
    window.addEventListener('hashchange', deactivateFullPageMode);
    window.addEventListener('popstate', deactivateFullPageMode);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
