// Background script for handling cross-origin requests
console.log('FlowFixer background script loaded - v2');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.type);
  
  if (request.type === 'CROSS_ORIGIN_REQUEST') {
    handleCrossOriginRequest(request, sendResponse);
    return true; // Keep the message channel open for async response
  }
});

async function handleCrossOriginRequest(request, sendResponse) {
  try {
    const { method, url, username, password, body, accept } = request;
    
    console.log('Background script making cross-origin request to:', url);
    console.log('Username received:', username ? 'Yes (' + username.substring(0, 3) + '***)' : 'No');
    console.log('Password received:', password ? 'Yes (length: ' + password.length + ')' : 'No');
    
    if (!username || !password) {
      throw new Error('Username and password are required for authentication');
    }
    
    const authHeader = 'Basic ' + btoa(username + ':' + password);
    console.log('Authorization header created:', authHeader.substring(0, 20) + '...');
    
    // Prepare headers based on request type
    const headers = {
      'Authorization': authHeader
    };
    
    if (method === 'POST' && body) {
      // For POST requests with body, use accept parameter as Content-Type
      headers['Content-Type'] = accept || 'application/xml';
      console.log('Content-Type set to:', headers['Content-Type']);
    } else if (accept) {
      // For GET requests, use accept parameter as Accept header
      headers['Accept'] = accept;
    }
    
    const response = await fetch(url, {
      method: method,
      headers: headers,
      ...(body && { body: body }),
      credentials: 'omit' // Don't send cookies for cross-origin requests
    });
    
    console.log('Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      throw new Error(`${method} ${url} status ${response.status} - ${response.statusText}`);
    }
    
    const responseText = await response.text();
    sendResponse({ success: true, data: responseText });
    
  } catch (error) {
    console.error('Background script request failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}