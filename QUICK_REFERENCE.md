# Quick Reference - Attachment Fetching & Resending

## API Endpoints

### Get Failed Messages
```
GET /api/v1/MessageProcessingLogs?$filter=Status eq 'FAILED'&$format=json
Auth: Basic username:password
```

### Get Message Attachments
```
GET /api/v1/MessageProcessingLogs('${MessageGuid}')/Attachments?$format=json
Auth: Basic username:password
```

### Download Attachment Payload
```
GET /api/v1/MessageProcessingLogAttachments('${AttachmentId}')/$value
Auth: Basic clientId:clientSecret (CF) or username:password (NEO)
```

### Get iFlow Endpoint
```
GET /api/v1/IntegrationRuntimeArtifacts?$filter=Name eq '${iFlowName}'&$expand=EntryPoints&$format=json
Auth: Basic username:password
```

### Resend Message
```
POST ${iFlowEndpointUrl}
Auth: Basic clientId:clientSecret (CF) or username:password (NEO)
Content-Type: application/xml
Body: ${payload}
```

## Key Functions

### Fetch and Save Payloads
```javascript
await fetchAndSaveFailedMessagesWithPayloads(
  'iFlowSymbolicName',
  'username',
  'password',
  (progress) => console.log(progress)
);
```

### Get Saved Payloads
```javascript
const allPayloads = await getAllSavedPayloads();
const iflowPayloads = allPayloads['iFlowSymbolicName'];
```

### Resend Messages
```javascript
await resendSelectedMessages(
  [{ messageId: 'ABC-123' }],
  'iFlowSymbolicName',
  'username',
  'password',
  (status) => console.log(status)
);
```

## URL Patterns

### NEO
```
https://tenant.hana.ondemand.com/api/v1/...
```

### Cloud Foundry
```
API:   https://tenant.it-cpitrial05.cfapps.region.hana.ondemand.com/api/v1/...
iFlow: https://tenant.integrationsuite-trial.cfapps.region.hana.ondemand.com/http/...
```

## Storage Structure
```javascript
{
  "resenderPayloads": {
    "iFlowName": [
      {
        "messageGuid": "...",
        "payload": "...",
        "attachments": [...]
      }
    ]
  }
}
```

## Common Issues

| Issue | Solution |
|-------|----------|
| 404 on attachment URL | Use integrationsuite domain instead of it-cpitrial |
| 401 Unauthorized | Check credentials (username/password for API, clientId/secret for iFlow) |
| CORS error | Ensure manifest.json has correct host_permissions |
| No attachments | Message may not have been processed far enough |
| Extension context invalidated | Reload the page |

## Testing Commands

```bash
# Get failed messages
curl "https://tenant.it-cpitrial05.cfapps.region.hana.ondemand.com/api/v1/MessageProcessingLogs?\$filter=Status%20eq%20'FAILED'&\$format=json" \
  -H "Authorization: Basic $(echo -n 'user:pass' | base64)"

# Get attachments
curl "https://tenant.it-cpitrial05.cfapps.region.hana.ondemand.com/api/v1/MessageProcessingLogs('MSG-GUID')/Attachments?\$format=json" \
  -H "Authorization: Basic $(echo -n 'user:pass' | base64)"

# Download payload
curl "https://tenant.integrationsuite-trial.cfapps.region.hana.ondemand.com/api/v1/MessageProcessingLogAttachments('ATT-ID')/\$value" \
  -H "Authorization: Basic $(echo -n 'client:secret' | base64)"

# Resend
curl -X POST "https://tenant.integrationsuite-trial.cfapps.region.hana.ondemand.com/http/iflow" \
  -H "Authorization: Basic $(echo -n 'client:secret' | base64)" \
  -H "Content-Type: application/xml" \
  -d @payload.xml
```

## Workflow

1. Configure credentials in Resender Interface
2. Click "Fetch All Payloads" or "Fetch Payloads" for specific iFlow
3. Wait for progress updates
4. Click on failed count to view messages
5. Select messages with checkboxes
6. Click "Resend Selected"
7. Review results

## Files

- `contentScript.js` - Main logic
- `resender_functions.js` - API functions
- `resender_ui.js` - UI components
- `background.js` - CORS handling
- `manifest.json` - Permissions

## Documentation

- `ATTACHMENT_FETCHING.md` - Technical details
- `EXAMPLE_USAGE.md` - Usage examples
- `ATTACHMENT_IMPLEMENTATION_SUMMARY.md` - Implementation overview
- `README_RESENDER.md` - User guide
