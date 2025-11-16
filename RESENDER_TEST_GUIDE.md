# Message Resender Testing Guide

## Overview
This guide will help you test the complete message resending functionality, from fetching failed messages to resending them back to the iFlow.

## Prerequisites
1. Extension installed and loaded
2. SAP Integration Suite access (NEO or Cloud Foundry)
3. At least one iFlow with failed messages
4. Valid credentials (username/password for NEO, or Client ID/Secret for CF)

## Testing Flow

### Step 1: Configure Resender (Cloud Foundry Only)
If you're on Cloud Foundry, you need to configure the API URL and credentials first:

1. Open the extension popup
2. Click "Configure Resender"
3. Enter:
   - **API URL**: Your tenant URL (e.g., `https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-002.hana.ondemand.com`)
   - **Username**: Your SAP BTP username
   - **Password**: Your SAP BTP password
   - **Client ID**: OAuth Client ID for iFlow calls
   - **Client Secret**: OAuth Client Secret for iFlow calls
4. Click "Save"

**Note**: For NEO, this step is not required as it uses the current page URL.

### Step 2: Access Message Resender
1. Navigate to your SAP Integration Suite
2. Click "CPI Helper Lite" in the left navigation
3. Click "Message Resender" button

### Step 3: View iFlows with Failed Messages
You should see a table showing:
- iFlow Name
- Failed Count (number of failed messages)
- Saved Payloads (number of payloads already fetched)
- Actions (Fetch Payloads button)

### Step 4: Fetch Payloads for an iFlow
1. Click "Fetch Payloads" for an iFlow
2. Watch the status bar for progress:
   - "Fetching failed messages for [iFlow]..."
   - "Found X failed messages, fetching payloads..."
   - "Processing 1/X: [messageId]..."
   - "Successfully saved X messages with payloads"
3. The "Saved Payloads" column should update with the count

**What happens behind the scenes:**
- Fetches failed messages from OData API
- For each message, fetches attachments
- For each attachment, fetches the payload content
- Saves all payloads to Chrome storage

### Step 5: View Failed Messages
1. Click on the "Failed Count" number (blue link) for an iFlow
2. You should see a detailed table with:
   - Checkbox (enabled only if payload is saved)
   - Message ID
   - Status
   - Log Start timestamp
   - Payload status (✓ Saved or ✗ Not saved)
   - Error details

### Step 6: Select Messages to Resend
1. Click individual checkboxes to select specific messages
2. Or click "Select All" to select all messages with saved payloads
3. The "Resend Selected" button should show the count: "Resend Selected (X)"

### Step 7: Resend Messages
1. Click "Resend Selected (X)" button
2. Confirm the action in the dialog
3. Watch the status for progress:
   - "Fetching iFlow endpoint for [iFlow]..."
   - "Resending 1/X: [messageId]..."
   - "Completed: X/Y messages resent successfully"
4. An alert will show the final result

**What happens behind the scenes:**
- Fetches the iFlow endpoint URL from IntegrationRuntimeArtifacts API
- For each selected message:
  - Retrieves the saved payload from storage
  - POSTs the payload to the iFlow endpoint
  - Records success/failure
- Shows summary of results

## Expected Results

### Successful Resend
- Status shows "Completed: X/X messages resent successfully"
- Alert shows "Successfully resent X/X messages"
- Messages should appear in the iFlow's message monitoring

### Partial Success
- Status shows "Completed: X/Y messages resent successfully"
- Alert shows "Successfully resent X/Y messages"
- Check console logs for specific errors

### Complete Failure
- Status shows "Error: [error message]"
- Alert shows "Failed to resend messages: [error]"
- Common errors:
  - "No endpoint found for iFlow" - iFlow might not be deployed
  - "401/403" - Authentication issue
  - "404" - Endpoint URL incorrect
  - "No payload found" - Payload wasn't fetched properly

## Troubleshooting

### Issue: "No saved payloads found"
**Solution**: Click "Fetch Payloads" first to download the message payloads.

### Issue: "API URL is required for Cloud Foundry environment"
**Solution**: Configure the resender with your API URL in the popup settings.

### Issue: "No endpoint found for iFlow"
**Possible causes**:
- iFlow is not deployed
- iFlow name doesn't match exactly
- Using wrong credentials

**Solution**: 
- Verify iFlow is deployed and running
- Check the iFlow name in the Integration Suite UI
- Verify credentials have proper permissions

### Issue: "Extension context invalidated"
**Solution**: Reload the page and try again.

### Issue: Authentication errors (401/403)
**For NEO**: Verify username/password are correct
**For CF**: 
- Verify Client ID/Secret are correct
- Ensure OAuth client has proper scopes
- Check if credentials are for the right environment

### Issue: Messages resent but not appearing in monitoring
**Possible causes**:
- iFlow processed the message successfully (check completed messages)
- iFlow failed again (check failed messages)
- Wrong endpoint was used

**Solution**:
- Check both completed and failed message logs
- Verify the endpoint URL in console logs
- Test the iFlow with a simple test message first

## Console Debugging

Open browser DevTools (F12) and check console for detailed logs:

```javascript
// Fetch payloads logs
'Fetching failed messages for [iFlow]...'
'Found X failed messages, fetching payloads...'
'Processing X/Y: [messageId]...'
'Fetching attachments for message: [messageId]'
'Fetched payload for attachment [id], length: X'

// Resend logs
'Fetching iFlow endpoint for [iFlow]...'
'iFlow endpoint: { url: "...", type: "...", name: "..." }'
'Resending message to: [endpoint]'
'Payload length: X'
'Content-Type: application/xml'
'Message resent successfully, response: ...'
```

## API Endpoints Used

### Fetch Failed Messages
```
GET /api/v1/MessageProcessingLogs?$filter=IntegrationFlowName eq '[iFlow]' and Status eq 'FAILED'&$orderby=LogStart desc&$top=200&$format=json
```

### Fetch Attachments
```
GET /api/v1/MessageProcessingLogs('[messageGuid]')/Attachments?$format=json
```

### Fetch Payload
```
GET /api/v1/MessageProcessingLogAttachments('[attachmentId]')/$value
```

### Fetch iFlow Endpoint
```
GET /api/v1/IntegrationRuntimeArtifacts?$filter=Name eq '[iFlow]'&$expand=EntryPoints&$format=json
```

### Resend Message
```
POST [iFlow endpoint URL]
Content-Type: application/xml
Authorization: Basic [credentials]
Body: [payload]
```

## Best Practices

1. **Test with one message first**: Select and resend a single message to verify the setup works
2. **Check iFlow logs**: After resending, check the iFlow's message monitoring to verify receipt
3. **Batch carefully**: Don't resend too many messages at once to avoid overwhelming the system
4. **Verify payloads**: Ensure payloads are fetched successfully before attempting to resend
5. **Use correct credentials**: NEO uses username/password, CF uses Client ID/Secret for iFlow calls

## Known Limitations

1. **Storage limit**: Chrome storage has a limit (~5MB). Large payloads or many messages may hit this limit.
2. **Cross-origin**: CF environments require background script for cross-origin requests.
3. **Payload format**: Currently assumes XML payloads. JSON or other formats may need adjustment.
4. **Concurrent requests**: Limited to avoid overwhelming the API (6 concurrent requests).

## Success Criteria

✅ Can view iFlows with failed messages
✅ Can fetch and save payloads for failed messages
✅ Can view detailed message list with payload status
✅ Can select messages with saved payloads
✅ Can resend selected messages successfully
✅ Resent messages appear in iFlow monitoring
✅ Error handling works properly for various failure scenarios
