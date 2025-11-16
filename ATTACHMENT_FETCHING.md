# Attachment Fetching Implementation

This document explains how the extension fetches message attachments and payloads from SAP CPI.

## Overview

The extension uses a multi-step process to retrieve failed message payloads:

1. Fetch failed messages from MessageProcessingLogs
2. For each message, fetch its attachments
3. Download the payload content from each attachment
4. Store payloads locally in Chrome storage

## API Endpoints Used

### 1. Message Processing Logs

**Endpoint**: `/api/v1/MessageProcessingLogs`

**Purpose**: Get list of failed messages

**Example**:
```
GET /api/v1/MessageProcessingLogs?$filter=IntegrationFlowName eq 'MyIFlow' and Status eq 'FAILED'&$orderby=LogStart desc&$top=200&$format=json
```

**Response**: Array of message objects with MessageGuid, Status, ErrorText, etc.

### 2. Message Attachments

**Endpoint**: `/api/v1/MessageProcessingLogs('${MessageGuid}')/Attachments`

**Purpose**: Get list of attachments for a specific message

**Example**:
```
GET /api/v1/MessageProcessingLogs('ABC123-456-789')/Attachments?$format=json
```

**Response**: Array of attachment objects with Id, Name, ContentType

### 3. Attachment Payload

**Endpoint**: `/api/v1/MessageProcessingLogAttachments('${AttachmentId}')/$value`

**Purpose**: Download the actual payload content

**Example**:
```
GET /api/v1/MessageProcessingLogAttachments('ATT-123-456')/$value
```

**Response**: Raw payload content (XML, JSON, etc.)

## Implementation Details

### Function: `fetchAndSaveFailedMessagesWithPayloads`

Located in `contentScript.js`, this function orchestrates the entire process:

```javascript
async function fetchAndSaveFailedMessagesWithPayloads(
  iflowSymbolicName, 
  username, 
  password, 
  progressCallback
)
```

**Parameters**:
- `iflowSymbolicName`: The symbolic name of the iFlow
- `username`: SAP username (or Client ID for CF)
- `password`: SAP password (or Client Secret for CF)
- `progressCallback`: Function to report progress updates

**Process**:

1. **Determine Base URL**
   - NEO: Uses current host
   - Cloud Foundry: Uses saved API URL from storage

2. **Fetch Failed Messages**
   ```javascript
   const messages = await listFailedMessagesForIflow(iflowSymbolicName, 200);
   ```

3. **For Each Message, Fetch Attachments**
   ```javascript
   const attachmentsUrl = `${baseUrl}/api/v1/MessageProcessingLogs('${msg.messageId}')/Attachments?$format=json`;
   const attachmentsResponse = await httpWithAuth('GET', attachmentsUrl, apiUsername, apiPassword, null, 'application/json');
   ```

4. **Download Payload from First Attachment**
   ```javascript
   const attachmentId = firstAttachment.Id || firstAttachment.ID;
   const payloadUrl = `${baseUrl}/api/v1/MessageProcessingLogAttachments('${attachmentId}')/$value`;
   const payload = await httpWithAuth('GET', payloadUrl, apiUsername, apiPassword, null, 'application/octet-stream');
   ```

5. **Save to Chrome Storage**
   ```javascript
   await savePayloadsForIflow(iflowSymbolicName, messagesWithPayloads);
   ```

### Storage Structure

Payloads are stored in Chrome's local storage under the key `resenderPayloads`:

```javascript
{
  "resenderPayloads": {
    "iFlowSymbolicName1": [
      {
        "messageGuid": "ABC-123",
        "integrationFlowName": "MyIFlow",
        "status": "FAILED",
        "errorText": "Connection timeout",
        "payload": "<xml>...</xml>",
        "attachments": [
          {
            "id": "ATT-123",
            "name": "payload",
            "contentType": "application/xml"
          }
        ]
      }
    ],
    "iFlowSymbolicName2": [...]
  }
}
```

## Environment-Specific Considerations

### NEO Environment

- Uses current host for all API calls
- Single set of credentials (username/password)
- Same-origin requests (no CORS issues)

**Example Base URL**: `https://tenant.hana.ondemand.com`

### Cloud Foundry Environment

- Requires separate API URL configuration
- Two sets of credentials:
  - Username/Password for API calls (ServiceEndpoints, MessageProcessingLogs)
  - Client ID/Secret for iFlow calls (resending)
- Cross-origin requests (uses background script for CORS)

**Example Base URLs**:
- API URL: `https://tenant.it-cpitrial05.cfapps.region.hana.ondemand.com`
- iFlow URL: `https://tenant.integrationsuite-trial.cfapps.region.hana.ondemand.com`

**Note**: The attachment payload URL may need domain adjustment in CF environments:
```javascript
// For CF, replace it-cpitrial with integrationsuite-trial
if (!isNEO && baseUrl.includes('.cfapps.')) {
  payloadUrl = payloadUrl.replace(/\/\/[^.]+\.it-cpi/, '//trial-xp03lcjj.integrationsuite-');
}
```

## Cross-Origin Request Handling

The extension uses a background service worker to handle cross-origin requests:

### Content Script → Background Script

```javascript
chrome.runtime.sendMessage({
  type: 'CROSS_ORIGIN_REQUEST',
  method: 'GET',
  url: fullUrl,
  username: username,
  password: password,
  accept: 'application/json'
}, (response) => {
  if (response.success) {
    resolve(response.data);
  }
});
```

### Background Script Processing

```javascript
const authHeader = 'Basic ' + btoa(username + ':' + password);
const response = await fetch(url, {
  method: method,
  headers: {
    'Authorization': authHeader,
    'Accept': accept
  }
});
```

## Error Handling

The implementation includes comprehensive error handling:

1. **Network Errors**: Caught and reported with user-friendly messages
2. **Authentication Errors**: 401/403 status codes trigger credential re-entry
3. **Missing Attachments**: Messages without attachments are saved with `payload: null`
4. **Partial Failures**: Individual message failures don't stop the batch process

## Performance Considerations

- **Batch Processing**: Messages are processed sequentially to avoid overwhelming the API
- **Progress Callbacks**: UI updates after each message to show progress
- **Storage Limits**: Chrome storage has a 5MB limit per item (use QUOTA_BYTES_PER_ITEM)
- **Concurrency**: No parallel requests to avoid rate limiting

## Testing

To test attachment fetching:

1. Create a failed message in your iFlow with a payload
2. Open the extension and navigate to Resender Interface
3. Click "Fetch Payloads" for the iFlow
4. Check browser console for detailed logs
5. Verify payload is saved in Chrome storage (DevTools → Application → Storage)

## Troubleshooting

### "No attachments found"
- Message may not have been processed far enough to create attachments
- Check message status in CPI monitoring

### "404 Not Found" on attachment URL
- URL structure may differ between environments
- Check the actual attachment ID format in the API response

### "Extension context invalidated"
- Extension was reloaded while operation was in progress
- Reload the page and try again

### Cross-origin errors
- Ensure manifest.json includes the correct host_permissions
- Check that background script is properly handling CORS requests

## Future Enhancements

Potential improvements:

1. **Multiple Attachment Support**: Currently only fetches first attachment
2. **Compression**: Compress payloads before storing to save space
3. **Selective Fetching**: Allow users to choose which messages to fetch
4. **Export/Import**: Export payloads to file system for backup
5. **Payload Preview**: Show payload content before resending
