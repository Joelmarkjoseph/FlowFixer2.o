# Architecture Overview - SAP CPI Message Resender

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Chrome Browser                          │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Extension Components                    │ │
│  │                                                            │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
│  │  │   Popup      │  │  Background  │  │   Content    │      │ │
│  │  │   (popup.js) │  │  (background │  │   Script     │      │ │
│  │  │              │  │   .js)       │  │(contentScript│      │ │
│  │  │  - Show      │  │              │  │   .js)       │      │ │
│  │  │    stats     │  │  - Handle    │  │              │      │ │
│  │  │  - Quick     │  │    CORS      │  │  - Main UI   │      │ │
│  │  │    view      │  │  - Proxy     │  │  - API calls │      │ │
│  │  │              │  │    requests  │  │  - Events    │      │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
│  │                                                            │ │
│  │  ┌──────────────┐  ┌──────────────┐                        │ │
│  │  │  Resender    │  │  Resender    │                        │ │
│  │  │  Functions   │  │  UI          │                        │ │
│  │  │              │  │              │                        │ │
│  │  │  - Fetch     │  │  - Overview  │                        │ │
│  │  │    payloads  │  │  - Message   │                        │ │ 
│  │  │  - Storage   │  │    list      │                        │ │
│  │  │  - Resend    │  │  - Selection │                        │ │
│  │  │    logic     │  │  - Actions   │                        │ │
│  │  └──────────────┘  └──────────────┘                        │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │           Chrome Storage API (storage.local)         │  │ │
│  │  │                                                      │  │ │
│  │  │  - Credentials (encrypted by Chrome)                 │  │ │
│  │  │  - Payloads (payload_IFlowName_MessageGuid)          │  │ │
│  │  │  - Metadata                                          │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ HTTPS
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                      SAP Cloud Platform                          │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              CPI Integration Suite APIs                     │ │
│  │                                                              │ │
│  │  /odata/api/v1/MessageProcessingLogs                       │ │
│  │  /odata/api/v1/MessageProcessingLogs('id')/Attachments    │ │
│  │  /odata/api/v1/MessageProcessingLogAttachments('id')/$value│ │
│  │  /odata/api/v1/IntegrationRuntimeArtifacts                 │ │
│  │  /Operations/...                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    iFlow Endpoints                          │ │
│  │                                                              │ │
│  │  https://tenant.cfapps.region.hana.ondemand.com/http/...  │ │
│  │  (Receives resent messages)                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Interaction Flow

### 1. Initialization

```
User opens CPI tenant
    ↓
contentScript.js loads
    ↓
Injects UI into page
    ↓
Loads saved credentials from storage
    ↓
Ready for user interaction
```

### 2. Fetch Payloads Flow

```
User clicks "Fetch All Payloads"
    ↓
resender_ui.js → fetchAllPayloads()
    ↓
For each iFlow:
    resender_functions.js → fetchAndSaveFailedMessagesWithPayloads()
        ↓
        contentScript.js → listFailedMessagesForIflow()
            ↓
            HTTP GET /MessageProcessingLogs?$filter=Status eq 'FAILED'
            ↓
        For each message:
            resender_functions.js → fetchMessageAttachments()
                ↓
                HTTP GET /MessageProcessingLogs('id')/Attachments
                ↓
            resender_functions.js → fetchAttachmentPayload()
                ↓
                HTTP GET /MessageProcessingLogAttachments('id')/$value
                ↓
            resender_functions.js → saveMessagePayload()
                ↓
                chrome.storage.local.set()
    ↓
Update UI with saved counts
```

### 3. Resend Messages Flow

```
User selects messages and clicks "Resend Selected"
    ↓
resender_ui.js → setupCheckboxHandlers() → resendBtn.onclick
    ↓
resender_functions.js → resendSelectedMessages()
    ↓
resender_functions.js → fetchIflowEndpoint()
        ↓
        HTTP GET /IntegrationRuntimeArtifacts?$filter=Name eq 'XXX'&$expand=EntryPoints
        ↓
        Extract endpoint URL
    ↓
For each selected message:
    resender_functions.js → getMessagePayload()
        ↓
        chrome.storage.local.get()
        ↓
    resender_functions.js → resendMessage()
        ↓
        contentScript.js → httpWithAuth()
            ↓
            If cross-origin:
                background.js → handleCrossOriginRequest()
                    ↓
                    HTTP POST {iflow_endpoint_url}
                    Authorization: Basic {credentials}
                    Body: {payload}
            Else:
                HTTP POST {iflow_endpoint_url}
                Authorization: Basic {credentials}
                Body: {payload}
    ↓
Collect results
    ↓
Display success/failure counts
```

## Data Models

### 1. Stored Payload

```javascript
{
  "payload_OrderProcessing_ABC123": {
    iflowName: "OrderProcessing",
    messageGuid: "ABC123-DEF456-GHI789",
    payload: "<soapenv:Envelope>...</soapenv:Envelope>",
    metadata: {
      status: "FAILED",
      errorText: "Connection timeout",
      errorDetails: "Failed to connect to backend system",
      logStart: "2024-01-15T10:30:00Z",
      attachments: [
        {
          id: "ATT001",
          name: "payload",
          contentType: "application/xml"
        }
      ],
      savedAt: "2024-01-15T11:00:00Z"
    }
  }
}
```

### 2. Credentials

```javascript
{
  // NEO
  resenderUsername: "user@example.com",
  resenderPassword: "encrypted_password",
  
  // Cloud Foundry (additional)
  resenderApiUrl: "https://tenant.cfapps.region.hana.ondemand.com",
  resenderClientId: "client_id",
  resenderClientSecret: "client_secret"
}
```

### 3. iFlow Summary

```javascript
{
  name: "OrderProcessing",
  symbolicName: "OrderProcessing",
  failed: 45,
  total: 1279,
  completed: 1234
}
```

### 4. Failed Message

```javascript
{
  messageId: "ABC123-DEF456-GHI789",
  status: "FAILED",
  errorText: "Connection timeout",
  errorDetails: "Failed to connect to backend system after 3 retries",
  logStart: "2024-01-15T10:30:00Z",
  integrationFlowName: "OrderProcessing"
}
```

### 5. iFlow Endpoint

```javascript
{
  url: "https://tenant.cfapps.region.hana.ondemand.com/http/orderprocessing",
  type: "HTTP",
  name: "OrderProcessing_Endpoint"
}
```

## API Call Sequence

### Scenario: Fetch and Resend 3 Messages

```
1. User Authentication
   ├─ Input: username, password
   └─ Output: Credentials saved to storage

2. Get iFlows with Failures
   ├─ GET /Operations/...IntegrationComponentsListCommand
   ├─ For each iFlow:
   │  └─ GET /MessageProcessingLogs/$count?$filter=Status eq 'FAILED'
   └─ Output: List of iFlows with failed counts

3. Fetch Payloads for iFlow "OrderProcessing"
   ├─ GET /MessageProcessingLogs?$filter=IntegrationFlowName eq 'OrderProcessing' and Status eq 'FAILED'
   │  └─ Returns: 3 messages [MSG1, MSG2, MSG3]
   │
   ├─ For MSG1:
   │  ├─ GET /MessageProcessingLogs('MSG1')/Attachments
   │  │  └─ Returns: [ATT1]
   │  ├─ GET /MessageProcessingLogAttachments('ATT1')/$value
   │  │  └─ Returns: <xml>payload1</xml>
   │  └─ chrome.storage.local.set({ "payload_OrderProcessing_MSG1": {...} })
   │
   ├─ For MSG2:
   │  ├─ GET /MessageProcessingLogs('MSG2')/Attachments
   │  │  └─ Returns: [ATT2]
   │  ├─ GET /MessageProcessingLogAttachments('ATT2')/$value
   │  │  └─ Returns: <xml>payload2</xml>
   │  └─ chrome.storage.local.set({ "payload_OrderProcessing_MSG2": {...} })
   │
   └─ For MSG3:
      ├─ GET /MessageProcessingLogs('MSG3')/Attachments
      │  └─ Returns: [ATT3]
      ├─ GET /MessageProcessingLogAttachments('ATT3')/$value
      │  └─ Returns: <xml>payload3</xml>
      └─ chrome.storage.local.set({ "payload_OrderProcessing_MSG3": {...} })

4. User Selects and Resends Messages
   ├─ User selects MSG1, MSG2, MSG3
   ├─ User clicks "Resend Selected (3)"
   │
   ├─ GET /IntegrationRuntimeArtifacts?$filter=Name eq 'OrderProcessing'&$expand=EntryPoints
   │  └─ Returns: { url: "https://...../http/orderprocessing" }
   │
   ├─ For MSG1:
   │  ├─ chrome.storage.local.get("payload_OrderProcessing_MSG1")
   │  │  └─ Returns: { payload: "<xml>payload1</xml>" }
   │  └─ POST https://...../http/orderprocessing
   │     Headers: Authorization: Basic xxx, Content-Type: application/xml
   │     Body: <xml>payload1</xml>
   │     └─ Returns: 202 Accepted
   │
   ├─ For MSG2:
   │  ├─ chrome.storage.local.get("payload_OrderProcessing_MSG2")
   │  │  └─ Returns: { payload: "<xml>payload2</xml>" }
   │  └─ POST https://...../http/orderprocessing
   │     Headers: Authorization: Basic xxx, Content-Type: application/xml
   │     Body: <xml>payload2</xml>
   │     └─ Returns: 202 Accepted
   │
   └─ For MSG3:
      ├─ chrome.storage.local.get("payload_OrderProcessing_MSG3")
      │  └─ Returns: { payload: "<xml>payload3</xml>" }
      └─ POST https://...../http/orderprocessing
         Headers: Authorization: Basic xxx, Content-Type: application/xml
         Body: <xml>payload3</xml>
         └─ Returns: 202 Accepted

5. Display Results
   └─ Alert: "Successfully resent 3/3 messages"
```

## Error Handling Flow

```
API Call
    ↓
Try
    ↓
    Success? → Return data
    ↓
Catch
    ↓
    ├─ 401/403 → "Authentication failed"
    ├─ 404 → "Endpoint not found"
    ├─ Network error → "Network error"
    ├─ Timeout → "Request timeout"
    └─ Other → "Error: {message}"
    ↓
Display error to user
    ↓
Log to console
    ↓
Allow retry
```

## Storage Management

```
chrome.storage.local
    ├─ Credentials (persistent)
    │  ├─ resenderUsername
    │  ├─ resenderPassword
    │  ├─ resenderApiUrl (CF only)
    │  ├─ resenderClientId (CF only)
    │  └─ resenderClientSecret (CF only)
    │
    └─ Payloads (can be cleared)
       ├─ payload_IFlow1_MSG1
       ├─ payload_IFlow1_MSG2
       ├─ payload_IFlow2_MSG1
       └─ ...

Storage Limits:
    - Total: 10MB (default)
    - Can be increased with "unlimitedStorage" permission
    - Typical payload: 10-50KB
    - Capacity: ~200-1000 messages

Cleanup Strategy:
    - Manual: User clears browser data
    - Automatic: Implement TTL (future enhancement)
    - Selective: Delete by iFlow or date (future enhancement)
```

## Security Architecture

```
┌─────────────────────────────────────────┐
│         User Credentials                 │
│  (entered in auth dialog)                │
└─────────────────────────────────────────┘
                │
                ↓
┌─────────────────────────────────────────┐
│    chrome.storage.local.set()           │
│  (encrypted by Chrome)                   │
└─────────────────────────────────────────┘
                │
                ↓
┌─────────────────────────────────────────┐
│    Used for API calls                    │
│  (Basic Auth header)                     │
└─────────────────────────────────────────┘
                │
                ↓
┌─────────────────────────────────────────┐
│    HTTPS to SAP CPI                      │
│  (encrypted in transit)                  │
└─────────────────────────────────────────┘

Security Layers:
1. Chrome encrypts storage.local data
2. HTTPS encrypts data in transit
3. Basic Auth for API authentication
4. Extension only works on SAP domains
5. No external API calls
6. No data sent to third parties
```

## Performance Optimization

```
Concurrency Control:
    ├─ Batch size: 6 concurrent requests
    ├─ Prevents overwhelming CPI
    └─ Balances speed vs. load

Caching:
    ├─ Payloads cached in storage
    ├─ Credentials cached
    └─ No need to re-fetch

Lazy Loading:
    ├─ Messages loaded on demand
    ├─ Pagination for large lists
    └─ Progressive rendering

Error Recovery:
    ├─ Retry failed requests
    ├─ Continue on partial failure
    └─ Track success/failure per message
```

## Deployment Architecture

```
Development:
    ├─ Load unpacked extension
    ├─ Test in Chrome DevTools
    └─ Iterate quickly

Testing:
    ├─ Manual testing
    ├─ Test with real CPI tenant
    └─ Verify in CPI monitoring

Production:
    ├─ Package as .crx file
    ├─ Distribute to users
    ├─ Or publish to Chrome Web Store
    └─ Auto-updates via Chrome

Monitoring:
    ├─ Browser console logs
    ├─ Chrome extension error reporting
    └─ User feedback
```

## Scalability Considerations

```
Current Limits:
    ├─ Storage: 10MB (~200-1000 messages)
    ├─ Concurrency: 6 requests at a time
    └─ No pagination for very large datasets

Scaling Options:
    ├─ Increase storage with "unlimitedStorage" permission
    ├─ Implement pagination for large message lists
    ├─ Add filtering/search capabilities
    ├─ Implement cleanup/archival
    └─ Consider backend service for very large scale
```

## Technology Stack

```
Frontend:
    ├─ Vanilla JavaScript (ES6+)
    ├─ Chrome Extension APIs
    ├─ DOM manipulation
    └─ CSS (inline styles)

Storage:
    ├─ chrome.storage.local
    └─ IndexedDB (future consideration)

Communication:
    ├─ XMLHttpRequest
    ├─ Fetch API (in background script)
    └─ Chrome message passing

APIs:
    ├─ SAP CPI OData v2/v4
    ├─ SAP CPI Operations API
    └─ iFlow HTTP endpoints

Libraries:
    └─ xmlToJson (XML parsing)
```

---

This architecture provides a solid foundation for the message resender functionality while maintaining simplicity and reliability.
