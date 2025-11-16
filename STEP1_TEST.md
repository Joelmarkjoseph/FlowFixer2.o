# Step 1 - Test Message Processing Logs Fetch (SIMPLIFIED)

## What This Does

When you click the "Resender Interface" button and enter your credentials, the extension will:

1. Show a simple authentication dialog
2. Extract the tenant URL from your current page OR use the API URL you provide
3. Build the MessageProcessingLogs API URL: `{baseUrl}/api/v1/MessageProcessingLogs?$select=...&$filter=...&$orderby=...`
4. Fetch the failed messages
5. Log them to the browser console

**That's it! Nothing else. No complex overview, no rendering, just fetch and log.**

## How to Test

### 1. Load the Extension
- Open Chrome and go to `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked" and select this folder
- The extension should load without errors

### 2. Navigate to Your CPI Tenant
- Go to: `https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com`
- Or any page within your SAP CPI tenant

### 3. Open Browser Console
- Press `F12` or right-click → Inspect
- Click on the "Console" tab
- Keep this open to see the logs

### 4. Click Resender Interface
- Find "CPI Helper Lite" in the left navigation OR
- Click the extension icon in the toolbar
- Click "Resender Interface" button

### 5. Enter Credentials
A dialog will appear asking for:

**For Cloud Foundry (your case):**
- **API URL**: `https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com`
- **Username**: Your SAP username
- **Password**: Your SAP password
- **Client ID**: (optional for this step)
- **Client Secret**: (optional for this step)

**For NEO:**
- **Username**: Your SAP username
- **Password**: Your SAP password

### 6. Click "Connect"

The extension will:
1. Show status: "Fetching message processing logs..."
2. Make the API call
3. Log the results to console
4. Show status: "Message processing logs fetched - check console"

## What You'll See in Console

```
Base URL: https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com
Fetching MessageProcessingLogs from: https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs?$select=MessageGuid,CorrelationId,...&$filter=Status eq 'FAILED' and LogStart ge datetime'2025-11-14T09:28:00.000'&$orderby=LogStart&$format=json
=== MESSAGE PROCESSING LOGS ===
Total logs fetched: 5
Logs: Array(5) [...]
(table showing all the logs)
=== END MESSAGE PROCESSING LOGS ===
```

## The API Call Being Made

```
GET https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs?
  $select=MessageGuid,CorrelationId,ApplicationMessageId,PredecessorMessageGuid,ApplicationMessageType,LogStart,LogEnd,Sender,Receiver,IntegrationFlowName,Status,AlternateWebLink,LogLevel,CustomStatus,ArchivingStatus,ArchivingSenderChannelMessages,ArchivingReceiverChannelMessages,ArchivingLogAttachments,ArchivingPersistedMessages,TransactionId,PreviousComponentName,LocalComponentName,OriginComponentName,IntegrationArtifact
  &$filter=Status eq 'FAILED' and LogStart ge datetime'2025-11-14T09:28:00.000'
  &$orderby=LogStart
  &$format=json

Authorization: Basic <base64(username:password)>
```

## Expected Response Structure

```json
{
  "value": [
    {
      "MessageGuid": "ABC123-456-789",
      "CorrelationId": "CORR-123",
      "ApplicationMessageId": "APP-MSG-001",
      "IntegrationFlowName": "MyIFlow",
      "Status": "FAILED",
      "LogStart": "2025-11-14T10:30:00.000Z",
      "LogEnd": "2025-11-14T10:30:05.000Z",
      "Sender": "SenderSystem",
      "Receiver": "ReceiverSystem",
      ...
    }
  ]
}
```

## Troubleshooting

### Error: "Could not determine base URL"
- Make sure you're on a CPI page
- Or provide the API URL in the dialog

### Error: "401 Unauthorized"
- Check your username and password
- Make sure you have access to the MessageProcessingLogs API

### Error: "404 Not Found"
- Verify the API URL is correct
- Check that `/api/v1/MessageProcessingLogs` endpoint exists

### Error: "CORS error"
- The extension should handle this automatically via background script
- Check that `manifest.json` includes your domain in `host_permissions`

### No logs in console
- Make sure the console is open (F12)
- Check the "Console" tab (not "Network" or other tabs)
- Look for the "=== MESSAGE PROCESSING LOGS ===" header

## What's Next?

Once you see the logs in the console and confirm they're correct, let me know and I'll add the next step!

The next steps will be:
1. Fetch attachments for each message
2. Download payload from attachments
3. Store payloads
4. Resend messages

But for now, we're just verifying the MessageProcessingLogs API call works correctly.
