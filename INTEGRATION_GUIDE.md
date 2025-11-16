# SAP CPI Message Resender - Integration Guide

## Overview
This guide explains how to integrate the message resender functionality into your existing CPI Helper Lite extension.

## What's Been Added

### New Files Created:
1. **resender_functions.js** - Core resender logic
2. **resender_ui.js** - UI components for resender interface
3. **INTEGRATION_GUIDE.md** - This file

## Integration Steps

### Step 1: Update manifest.json

Add the new JavaScript files to your content_scripts:

```json
"content_scripts": [
  {
    "matches": [
      "https://*.hana.ondemand.com/*",
      "https://*.platform.sapcloud.cn/*"
    ],
    "js": [
      "contentScript.js",
      "lib/xmlToJson/xmlToJson.js",
      "resender_functions.js",
      "resender_ui.js"
    ],
    "run_at": "document_idle"
  }
]
```

### Step 2: Update Permissions

Ensure you have the necessary permissions in manifest.json:

```json
"permissions": [
  "storage",
  "tabs"
],
"host_permissions": [
  "https://*.hana.ondemand.com/*",
  "https://*.platform.sapcloud.cn/*",
  "https://*.cfapps.*/*"
]
```

### Step 3: Integration Points

The new functions integrate seamlessly with your existing code:

#### A. In your existing "Resender Interface" button handler:

Replace the existing resender button logic with:

```javascript
root.querySelector('#cpi-lite-resender')?.addEventListener('click', async () => {
  const savedData = await safeStorageGet(['resenderUsername', 'resenderPassword']);
  
  if (savedData.resenderUsername && savedData.resenderPassword) {
    status.textContent = 'Loading iFlows with failed messages...';
    try {
      const iflowsWithFailures = await getFailedMessageCountsByIflow();
      renderResenderOverview(iflowsWithFailures, savedData);
      status.textContent = `Loaded ${iflowsWithFailures.length} iFlows with failures`;
    } catch (e) {
      status.textContent = String(e && e.message || e);
    }
  } else {
    showAuthDialogForResender(async (url, username, password) => {
      status.textContent = 'Loading iFlows with failed messages...';
      try {
        const credentials = { resenderUsername: username, resenderPassword: password };
        const iflowsWithFailures = await getFailedMessageCountsByIflow();
        renderResenderOverview(iflowsWithFailures, credentials);
        status.textContent = `Loaded ${iflowsWithFailures.length} iFlows with failures`;
      } catch (e) {
        status.textContent = String(e && e.message || e);
      }
    });
  }
});
```

## How It Works

### User Flow:

1. **Click "Resender Interface"** button
   - Shows iFlows with failed message counts
   
2. **Fetch Payloads**
   - Click "Fetch All Payloads" or individual "Fetch Payloads" buttons
   - Extension fetches failed messages via MessageProcessingLogs API
   - For each message, fetches attachments via `/Attachments` endpoint
   - Downloads payload via `/MessageProcessingLogAttachments('id')/$value`
   - Saves payloads to chrome.storage.local

3. **View Failed Messages**
   - Click on failed count for any iFlow
   - Shows list of failed messages with checkboxes
   - Only messages with saved payloads can be selected

4. **Resend Messages**
   - Select messages using checkboxes
   - Click "Resend Selected" button
   - Extension fetches iFlow endpoint via `/IntegrationRuntimeArtifacts` with `$expand=EntryPoints`
   - POSTs saved payload to iFlow endpoint
   - Shows success/failure status

### API Calls Made:

1. **Get Failed Messages:**
   ```
   GET /odata/api/v1/MessageProcessingLogs?$filter=IntegrationFlowName eq 'XXX' and Status eq 'FAILED'
   ```

2. **Get Attachments:**
   ```
   GET /odata/api/v1/MessageProcessingLogs('MessageGuid')/Attachments
   ```

3. **Get Payload:**
   ```
   GET /odata/api/v1/MessageProcessingLogAttachments('AttachmentId')/$value
   ```

4. **Get iFlow Endpoint:**
   ```
   GET /odata/api/v1/IntegrationRuntimeArtifacts?$filter=Name eq 'XXX'&$expand=EntryPoints
   ```

5. **Resend Message:**
   ```
   POST {iflow_endpoint_url}
   Content-Type: application/xml
   Authorization: Basic {credentials}
   Body: {saved_payload}
   ```

## Storage Structure

Payloads are stored in chrome.storage.local with this structure:

```javascript
{
  "payload_IFlowName_MessageGuid": {
    "iflowName": "MyIFlow",
    "messageGuid": "ABC123...",
    "payload": "<xml>...</xml>",
    "metadata": {
      "status": "FAILED",
      "errorText": "Error message",
      "errorDetails": "Detailed error",
      "logStart": "2024-01-01T00:00:00Z",
      "attachments": [...],
      "savedAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

## Key Functions

### From resender_functions.js:

- `fetchMessageAttachments(messageGuid, username, password)` - Get attachments for a message
- `fetchAttachmentPayload(attachmentId, username, password)` - Download payload
- `saveMessagePayload(iflowName, messageGuid, payload, metadata)` - Save to storage
- `getMessagePayload(iflowName, messageGuid)` - Retrieve from storage
- `getAllSavedPayloads()` - Get all saved payloads grouped by iFlow
- `fetchIflowEndpoint(iflowName, username, password)` - Get iFlow endpoint URL
- `resendMessage(endpoint, payload, username, password)` - POST message to iFlow
- `fetchAndSaveFailedMessagesWithPayloads(...)` - Batch fetch and save
- `resendSelectedMessages(...)` - Batch resend

### From resender_ui.js:

- `renderResenderOverview(iflowsWithFailures, credentials)` - Main resender view
- `showResenderMessages(symbolicName, displayName, credentials)` - Message list view
- `updateSavedCounts(iflows)` - Update payload counts in UI
- `fetchPayloadsForIflow(iflow, credentials)` - Fetch payloads for one iFlow
- `fetchAllPayloads(iflows, credentials)` - Fetch payloads for all iFlows
- `loadFailedMessages(...)` - Load and display failed messages
- `setupCheckboxHandlers(...)` - Wire up selection and resend logic

## Testing

### Test Scenarios:

1. **Fetch Payloads:**
   - Navigate to CPI tenant
   - Click "Resender Interface"
   - Click "Fetch All Payloads"
   - Verify payloads are saved (check "Saved Payloads" column)

2. **View Messages:**
   - Click on failed count for an iFlow
   - Verify messages are displayed with checkboxes
   - Verify only messages with saved payloads are selectable

3. **Resend Messages:**
   - Select one or more messages
   - Click "Resend Selected"
   - Verify messages are resent successfully
   - Check CPI monitoring to confirm messages were received

## Troubleshooting

### Common Issues:

1. **"Payload not found in storage"**
   - Solution: Click "Fetch Payloads" first to download payloads

2. **"No endpoint found for iFlow"**
   - Solution: Verify iFlow name matches exactly
   - Check if iFlow has HTTP entry points configured

3. **Authentication errors (401/403)**
   - Solution: Re-enter credentials
   - Verify user has necessary permissions

4. **CORS errors**
   - Solution: Background script should handle this automatically
   - Check browser console for details

5. **Storage quota exceeded**
   - Solution: Clear old payloads from chrome.storage.local
   - Consider implementing cleanup logic

## Limitations

1. **Storage Limit:** Chrome storage has a 10MB limit (can be increased with "unlimitedStorage" permission)
2. **Attachment Selection:** Currently fetches first attachment only (usually the logged payload)
3. **Content Type:** Assumes XML payloads (can be enhanced for JSON/other formats)
4. **Endpoint Selection:** Uses first HTTP entry point (can be enhanced to let user choose)

## Future Enhancements

1. Add payload preview before resending
2. Support for JSON and other content types
3. Bulk delete old payloads
4. Export/import payloads
5. Resend history tracking
6. Scheduled resend
7. Payload transformation before resend
8. Multi-tenant support

## Security Considerations

1. Credentials are stored in chrome.storage.local (encrypted by Chrome)
2. Payloads may contain sensitive data - consider adding encryption
3. Always use HTTPS for API calls
4. Implement proper error handling to avoid credential leakage in logs

## Support

For issues or questions:
1. Check browser console for detailed error messages
2. Verify API permissions in SAP CPI
3. Test API calls manually using Postman/curl
4. Check SAP CPI documentation for API changes

## License

Same as the original CPI Helper Lite extension.
