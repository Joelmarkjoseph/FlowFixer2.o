# Step 2 - Fetch Attachments and Payloads

## What This Does

After fetching the MessageProcessingLogs, the extension now:

1. Loops through each message
2. Fetches attachments for each message using: `/api/v1/MessageProcessingLogs('${MessageGuid}')/Attachments`
3. For each attachment, fetches the payload using: `/api/v1/MessageProcessingLogAttachments('${AttachmentId}')/$value`
4. Logs all payloads to the console

## The Flow

```
1. Fetch MessageProcessingLogs
   ↓
2. For each message:
   ↓
3. Fetch attachments
   GET {baseUrl}/api/v1/MessageProcessingLogs('MSG-GUID')/Attachments
   ↓
4. For each attachment:
   ↓
5. Fetch payload
   GET {integrationsuiteUrl}/api/v1/MessageProcessingLogAttachments('ATT-ID')/$value
   ↓
6. Log payload to console
```

## Important: Domain Change for Cloud Foundry

For Cloud Foundry environments, the payload URL uses a different domain:

- **Attachments API**: `https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com`
- **Payload API**: `https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com`

The code automatically replaces `it-cpitrial05` with `integrationsuite-trial`.

## How to Test

### 1. Reload the Extension
- Go to `chrome://extensions/`
- Click the reload icon on your extension

### 2. Navigate to Your CPI Tenant
- Go to your SAP CPI page

### 3. Open Browser Console
- Press `F12`
- Click "Console" tab
- Keep it open

### 4. Click "Resender Interface"
- Find the button in the extension or left navigation

### 5. Enter Credentials
- **API URL**: `https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com`
- **Username**: Your SAP username
- **Password**: Your SAP password
- **Client ID**: (optional for now)
- **Client Secret**: (optional for now)

### 6. Click "Connect"

## What You'll See in Console

```
Base URL: https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com
Fetching MessageProcessingLogs from: https://...
=== MESSAGE PROCESSING LOGS ===
Total logs fetched: 3
Logs: Array(3) [...]
(table)
=== END MESSAGE PROCESSING LOGS ===

=== FETCHING ATTACHMENTS AND PAYLOADS ===

[1/3] Processing message: ABC-123-456
  Fetching attachments from: https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs('ABC-123-456')/Attachments?$format=json
  Found 1 attachment(s)
    [Attachment 1/1] ID: ATT-001, Name: payload
      Fetching payload from: https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogAttachments('ATT-001')/$value
      ✓ Payload fetched (1234 bytes)
      Payload content: <?xml version="1.0"?>...

[2/3] Processing message: DEF-456-789
  Fetching attachments from: https://...
  Found 2 attachment(s)
    [Attachment 1/2] ID: ATT-002, Name: payload
      Fetching payload from: https://...
      ✓ Payload fetched (567 bytes)
      Payload content: {...}
    [Attachment 2/2] ID: ATT-003, Name: header
      Fetching payload from: https://...
      ✓ Payload fetched (123 bytes)
      Payload content: {...}

[3/3] Processing message: GHI-789-012
  Fetching attachments from: https://...
  No attachments found for this message

=== FINISHED FETCHING ATTACHMENTS AND PAYLOADS ===
```

## API Calls Being Made

### 1. Get Message Processing Logs
```
GET https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs?
  $select=MessageGuid,...
  &$filter=Status eq 'FAILED' and LogStart ge datetime'2025-11-14T09:28:00.000'
  &$orderby=LogStart
  &$format=json
```

### 2. Get Attachments for Each Message
```
GET https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs('ABC-123-456')/Attachments?$format=json
```

### 3. Get Payload for Each Attachment
```
GET https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogAttachments('ATT-001')/$value
```

## Expected Response Structures

### Attachments Response
```json
{
  "value": [
    {
      "Id": "ATT-001",
      "Name": "payload",
      "ContentType": "application/xml",
      "MessageGuid": "ABC-123-456"
    }
  ]
}
```

### Payload Response
Raw content (XML, JSON, text, etc.):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Order>
  <OrderId>12345</OrderId>
  <Customer>ACME Corp</Customer>
</Order>
```

## Troubleshooting

### Error: "404 Not Found" on Attachments
- The message may not have any attachments
- Check if the message was processed far enough to create attachments

### Error: "404 Not Found" on Payload
- Try using the integrationsuite domain instead of it-cpitrial
- The code should do this automatically for CF

### Error: "401 Unauthorized" on Payload
- For CF, you may need Client ID/Secret instead of username/password
- Try entering Client ID/Secret in the dialog

### No attachments found
- Some messages may not have attachments
- Check the message in CPI monitoring to verify

### CORS errors
- The extension should handle this via background script
- Check that manifest.json includes both domains in host_permissions

## What's Next?

Once you see the payloads in the console and confirm they're correct, let me know what to do next!

Possible next steps:
1. Store payloads in Chrome storage
2. Add UI to display payloads
3. Add resend functionality
4. Filter by iFlow
5. Something else?

Let me know! 🚀
