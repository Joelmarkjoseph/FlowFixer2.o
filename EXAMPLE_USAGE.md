# Example Usage: Fetching and Resending Messages

This guide shows practical examples of using the extension to fetch message payloads and resend them.

## Example Scenario

You have failed messages in your Cloud Foundry tenant and want to resend them.

**Your Environment**:
- Tenant: `trial-xp03lcjj`
- Region: `us10-001`
- API Domain: `it-cpitrial05.cfapps.us10-001.hana.ondemand.com`
- iFlow Domain: `integrationsuite-trial.cfapps.us10-001.hana.ondemand.com`

## Step 1: Configure the Extension

1. Open the Resender Interface
2. Enter your credentials:
   - **API URL**: `https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com`
   - **Username**: Your SAP username
   - **Password**: Your SAP password
   - **Client ID**: Your OAuth client ID (for iFlow calls)
   - **Client Secret**: Your OAuth client secret

## Step 2: Fetch Failed Messages

The extension will automatically call these APIs:

### Get Failed Messages
```http
GET https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs?$filter=IntegrationFlowName eq 'MyIFlow' and Status eq 'FAILED'&$orderby=LogStart desc&$top=200&$format=json
Authorization: Basic <base64(username:password)>
```

**Response Example**:
```json
{
  "value": [
    {
      "MessageGuid": "ABC123-456-789-DEF",
      "IntegrationFlowName": "MyIFlow",
      "Status": "FAILED",
      "LogStart": "2024-01-15T10:30:00.000Z",
      "ErrorText": "Connection timeout"
    }
  ]
}
```

## Step 3: Fetch Attachments for Each Message

For each failed message, the extension calls:

```http
GET https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs('ABC123-456-789-DEF')/Attachments?$format=json
Authorization: Basic <base64(username:password)>
```

**Response Example**:
```json
{
  "value": [
    {
      "Id": "ATT-001-ABC",
      "Name": "payload",
      "ContentType": "application/xml",
      "MessageGuid": "ABC123-456-789-DEF"
    }
  ]
}
```

## Step 4: Download Payload Content

For each attachment, the extension downloads the payload:

```http
GET https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com:443/api/v1/MessageProcessingLogAttachments('ATT-001-ABC')/$value
Authorization: Basic <base64(clientId:clientSecret)>
```

**Response**: Raw payload content (XML, JSON, etc.)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Order>
  <OrderId>12345</OrderId>
  <Customer>ACME Corp</Customer>
  <Items>
    <Item>
      <ProductId>PROD-001</ProductId>
      <Quantity>10</Quantity>
    </Item>
  </Items>
</Order>
```

## Step 5: Store Locally

The extension saves the payload in Chrome storage:

```javascript
{
  "resenderPayloads": {
    "MyIFlow": [
      {
        "messageGuid": "ABC123-456-789-DEF",
        "integrationFlowName": "MyIFlow",
        "status": "FAILED",
        "errorText": "Connection timeout",
        "logStart": "2024-01-15T10:30:00.000Z",
        "payload": "<?xml version=\"1.0\"...>",
        "attachments": [
          {
            "id": "ATT-001-ABC",
            "name": "payload",
            "contentType": "application/xml"
          }
        ]
      }
    ]
  }
}
```

## Step 6: Resend Messages

When you click "Resend Selected", the extension:

### 6.1: Fetch iFlow Endpoint

```http
GET https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/IntegrationRuntimeArtifacts?$filter=Name eq 'MyIFlow'&$expand=EntryPoints&$format=json
Authorization: Basic <base64(username:password)>
```

**Response Example**:
```json
{
  "value": [
    {
      "Name": "MyIFlow",
      "EntryPoints": [
        {
          "Name": "HTTP_Endpoint",
          "Type": "HTTP",
          "Url": "https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/http/myiflow"
        }
      ]
    }
  ]
}
```

### 6.2: POST Payload to Endpoint

```http
POST https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/http/myiflow
Authorization: Basic <base64(clientId:clientSecret)>
Content-Type: application/xml

<?xml version="1.0" encoding="UTF-8"?>
<Order>
  <OrderId>12345</OrderId>
  <Customer>ACME Corp</Customer>
  <Items>
    <Item>
      <ProductId>PROD-001</ProductId>
      <Quantity>10</Quantity>
    </Item>
  </Items>
</Order>
```

**Success Response**: HTTP 200 OK

## Complete Code Flow

Here's what happens behind the scenes:

```javascript
// 1. User clicks "Fetch Payloads"
await fetchAndSaveFailedMessagesWithPayloads(
  'MyIFlow',
  'username',
  'password',
  (progress) => console.log(progress)
);

// 2. Extension fetches failed messages
const messages = await listFailedMessagesForIflow('MyIFlow', 200);
// Returns: [{ messageId: 'ABC123...', status: 'FAILED', ... }]

// 3. For each message, fetch attachments
const attachmentsUrl = `${baseUrl}/api/v1/MessageProcessingLogs('${messageId}')/Attachments?$format=json`;
const attachments = await httpWithAuth('GET', attachmentsUrl, username, password);
// Returns: [{ Id: 'ATT-001-ABC', Name: 'payload', ... }]

// 4. Download payload
const payloadUrl = `${baseUrl}/api/v1/MessageProcessingLogAttachments('${attachmentId}')/$value`;
const payload = await httpWithAuth('GET', payloadUrl, clientId, clientSecret);
// Returns: "<xml>...</xml>"

// 5. Save to storage
await savePayloadsForIflow('MyIFlow', messagesWithPayloads);

// 6. User selects messages and clicks "Resend"
await resendSelectedMessages(
  [{ messageId: 'ABC123...' }],
  'MyIFlow',
  'username',
  'password',
  (status) => console.log(status)
);

// 7. Extension fetches endpoint
const endpointUrl = `${baseUrl}/api/v1/IntegrationRuntimeArtifacts?$filter=Name eq 'MyIFlow'&$expand=EntryPoints`;
const endpoint = await httpWithAuth('GET', endpointUrl, username, password);
// Returns: { Url: 'https://.../http/myiflow' }

// 8. POST payload to endpoint
await httpWithAuth('POST', endpoint.Url, clientId, clientSecret, payload, 'application/xml');
// Returns: Success or error
```

## URL Pattern Differences

### NEO Environment
- Single domain for all operations
- Example: `https://tenant.hana.ondemand.com`
- All URLs use the same base

### Cloud Foundry Environment
- Multiple subdomains for different operations
- API operations: `https://tenant.it-cpitrial05.cfapps.region.hana.ondemand.com`
- iFlow operations: `https://tenant.integrationsuite-trial.cfapps.region.hana.ondemand.com`
- Note the domain change: `it-cpitrial05` → `integrationsuite-trial`

## Troubleshooting Examples

### Issue: 404 on Attachment URL

**Problem**: 
```
GET https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogAttachments('ATT-001')/$value
→ 404 Not Found
```

**Solution**: Use the integrationsuite domain instead:
```
GET https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogAttachments('ATT-001')/$value
→ 200 OK
```

### Issue: CORS Error

**Problem**:
```
Access to fetch at 'https://different-tenant.cfapps...' from origin 'https://my-tenant.cfapps...' has been blocked by CORS policy
```

**Solution**: The extension automatically uses the background script for cross-origin requests. Ensure:
1. `manifest.json` includes the domain in `host_permissions`
2. `background.js` is properly handling CROSS_ORIGIN_REQUEST messages

### Issue: 401 Unauthorized

**Problem**:
```
GET /api/v1/MessageProcessingLogs(...)
→ 401 Unauthorized
```

**Solution**: Check credentials:
- For API calls: Use SAP username/password
- For iFlow calls: Use OAuth Client ID/Secret
- Verify credentials are saved correctly in extension storage

## Testing with curl

You can test the APIs manually using curl:

```bash
# 1. Get failed messages
curl -X GET \
  "https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs?\$filter=Status%20eq%20'FAILED'&\$top=10&\$format=json" \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)"

# 2. Get attachments for a message
curl -X GET \
  "https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs('MESSAGE-GUID')/Attachments?\$format=json" \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)"

# 3. Download attachment payload
curl -X GET \
  "https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogAttachments('ATTACHMENT-ID')/\$value" \
  -H "Authorization: Basic $(echo -n 'clientId:clientSecret' | base64)"

# 4. Resend to iFlow
curl -X POST \
  "https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/http/myiflow" \
  -H "Authorization: Basic $(echo -n 'clientId:clientSecret' | base64)" \
  -H "Content-Type: application/xml" \
  -d @payload.xml
```

## Summary

The extension automates this entire workflow:
1. ✅ Fetches failed messages from MessageProcessingLogs
2. ✅ Gets attachments for each message
3. ✅ Downloads payload content from attachments
4. ✅ Stores payloads locally in Chrome storage
5. ✅ Fetches iFlow endpoints when resending
6. ✅ POSTs payloads to endpoints with authentication
7. ✅ Handles cross-origin requests via background script
8. ✅ Manages different credentials for API vs iFlow calls
9. ✅ Provides progress feedback and error handling

All you need to do is:
1. Configure credentials
2. Click "Fetch Payloads"
3. Select messages
4. Click "Resend"
