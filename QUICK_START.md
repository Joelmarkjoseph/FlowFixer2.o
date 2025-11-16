# SAP CPI Message Resender - Quick Start Guide

## What This Extension Does

This Chrome extension allows you to:
1. ✅ View all iFlows and their message counts (completed/failed)
2. ✅ Fetch failed message payloads from SAP CPI logs
3. ✅ Store payloads locally in the browser
4. ✅ Select multiple failed messages
5. ✅ Resend messages to their original iFlow endpoints
6. ✅ Track resend success/failure

## Installation

1. **Load the Extension:**
   ```
   1. Open Chrome and go to chrome://extensions/
   2. Enable "Developer mode" (top right)
   3. Click "Load unpacked"
   4. Select this folder
   ```

2. **Verify Installation:**
   - You should see "CPI Helper Lite" in your extensions
   - The extension icon should appear in your toolbar

## Usage

### Step 1: Navigate to SAP CPI

Open your SAP Cloud Platform Integration tenant:
- NEO: `https://your-tenant.hana.ondemand.com/itspaces/`
- Cloud Foundry: `https://your-tenant.integrationsuite.cfapps.region.hana.ondemand.com/`

### Step 2: Open the Extension

Click the extension icon in your toolbar, or look for "CPI Helper Lite" in the left navigation.

### Step 3: View Message Overview

1. Click **"Get Message Overview"** button
2. Wait for the extension to load all iFlows
3. You'll see a table with:
   - iFlow names
   - Completed message counts (green)
   - Failed message counts (red)

### Step 4: Access Resender Interface

1. Click **"Resender Interface"** button
2. Enter your credentials when prompted:
   - **Username:** Your SAP username
   - **Password:** Your SAP password
   - **API URL (CF only):** Your tenant URL
   - **Client ID/Secret (CF only):** For iFlow authentication

3. You'll see iFlows with failed messages

### Step 5: Fetch Payloads

**Option A - Fetch All:**
1. Click **"Fetch All Payloads"** button
2. Wait for the extension to download all failed message payloads
3. Watch the status bar for progress

**Option B - Fetch Individual:**
1. Click **"Fetch Payloads"** button next to a specific iFlow
2. Wait for that iFlow's payloads to download

**What happens:**
- Extension calls MessageProcessingLogs API to get failed messages
- For each message, fetches attachments
- Downloads payload from first attachment (the logged payload)
- Saves to browser's local storage

### Step 6: View Failed Messages

1. Click on the **failed count** (red number) for any iFlow
2. You'll see a list of all failed messages with:
   - Message ID
   - Status
   - Timestamp
   - Payload status (✓ Saved or ✗ Not saved)
   - Error details

### Step 7: Select Messages to Resend

1. Use checkboxes to select messages
   - Only messages with saved payloads can be selected
   - Click "Select All" to select all available messages
2. The "Resend Selected" button shows count: `Resend Selected (3)`

### Step 8: Resend Messages

1. Click **"Resend Selected (X)"** button
2. Confirm the resend operation
3. Wait for the extension to:
   - Fetch the iFlow endpoint URL
   - POST each payload to the endpoint
   - Show success/failure status

4. Check the results:
   - Success count is displayed
   - Check SAP CPI monitoring to verify messages were received

## Example Workflow

```
1. Open SAP CPI tenant
2. Click extension → "Resender Interface"
3. Enter credentials
4. Click "Fetch All Payloads" → Wait for completion
5. Click failed count for "OrderProcessing" iFlow
6. Select 5 failed messages using checkboxes
7. Click "Resend Selected (5)"
8. Confirm → Wait for completion
9. See "Successfully resent 5/5 messages"
10. Verify in CPI monitoring
```

## Tips & Best Practices

### 1. Fetch Payloads First
- Always fetch payloads before trying to resend
- Payloads are stored locally, so you only need to fetch once
- Re-fetch if you need updated failed messages

### 2. Check Payload Status
- Only messages with "✓ Saved" can be resent
- If you see "✗ Not saved", go back and fetch payloads

### 3. Test with One Message First
- Select and resend one message first
- Verify it works before bulk resending

### 4. Monitor CPI
- Keep CPI monitoring open in another tab
- Watch for incoming messages after resend
- Check for any new errors

### 5. Credentials
- Credentials are saved in browser storage
- You won't need to re-enter them each time
- Clear browser data to remove saved credentials

## Troubleshooting

### "Payload not found in storage"
**Problem:** Trying to resend without fetching payloads first
**Solution:** Click "Fetch Payloads" button first

### "No endpoint found for iFlow"
**Problem:** iFlow name doesn't match or has no HTTP endpoints
**Solution:** 
- Verify iFlow name in CPI
- Check if iFlow has HTTP sender adapter configured
- Ensure iFlow is deployed

### "Authentication failed (401/403)"
**Problem:** Invalid credentials or insufficient permissions
**Solution:**
- Re-enter credentials
- Verify username/password are correct
- Check user has necessary roles in CPI

### "Extension context invalidated"
**Problem:** Extension was updated or reloaded
**Solution:** Refresh the CPI page

### Checkboxes are disabled
**Problem:** Payloads not fetched yet
**Solution:** Go back and click "Fetch Payloads"

### CORS errors in console
**Problem:** Cross-origin request blocked
**Solution:** This should be handled automatically by background script. If persists, check manifest.json permissions

## API Endpoints Used

The extension makes these API calls to SAP CPI:

1. **List iFlows:**
   ```
   GET /Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListCommand
   ```

2. **Count Messages:**
   ```
   GET /odata/api/v1/MessageProcessingLogs/$count?$filter=...
   ```

3. **Get Failed Messages:**
   ```
   GET /odata/api/v1/MessageProcessingLogs?$filter=Status eq 'FAILED'
   ```

4. **Get Attachments:**
   ```
   GET /odata/api/v1/MessageProcessingLogs('MessageGuid')/Attachments
   ```

5. **Get Payload:**
   ```
   GET /odata/api/v1/MessageProcessingLogAttachments('AttachmentId')/$value
   ```

6. **Get iFlow Endpoint:**
   ```
   GET /odata/api/v1/IntegrationRuntimeArtifacts?$filter=Name eq 'XXX'&$expand=EntryPoints
   ```

7. **Resend Message:**
   ```
   POST {iflow_endpoint_url}
   Authorization: Basic {credentials}
   Body: {payload}
   ```

## Storage

Payloads are stored in Chrome's local storage:
- **Location:** chrome.storage.local
- **Key format:** `payload_{IFlowName}_{MessageGuid}`
- **Size limit:** 10MB total (can be increased)
- **Persistence:** Survives browser restarts
- **Clearing:** Clear browser data to remove

## Security Notes

1. **Credentials:** Stored encrypted by Chrome in local storage
2. **Payloads:** May contain sensitive data - stored unencrypted locally
3. **HTTPS:** All API calls use HTTPS
4. **Permissions:** Extension only works on SAP domains
5. **No external calls:** All data stays between browser and SAP CPI

## Keyboard Shortcuts

- **Ctrl+Click** on failed count: Open in new view
- **Space** on checkbox: Toggle selection
- **Ctrl+A** in message list: Select all (if "Select All" button clicked)

## Browser Compatibility

- ✅ Chrome 88+
- ✅ Edge 88+ (Chromium-based)
- ❌ Firefox (uses different extension API)
- ❌ Safari (uses different extension API)

## Performance

- **Fetch time:** ~1-2 seconds per message
- **Storage:** ~10-50KB per payload (depends on message size)
- **Resend time:** ~1-2 seconds per message
- **Concurrent requests:** 6 at a time (to avoid overwhelming CPI)

## Limitations

1. **Attachment selection:** Only fetches first attachment
2. **Content type:** Optimized for XML (works with JSON too)
3. **Endpoint selection:** Uses first HTTP entry point
4. **Storage limit:** 10MB total (configurable)
5. **No scheduling:** Manual resend only
6. **No transformation:** Resends original payload as-is

## Support

For issues:
1. Check browser console (F12) for errors
2. Verify API permissions in SAP CPI
3. Test API calls manually using Postman
4. Check SAP CPI documentation

## Next Steps

After successful resend:
1. Monitor CPI for message processing
2. Check for any new errors
3. Verify business outcome
4. Clear old payloads if needed

## FAQ

**Q: Do I need to fetch payloads every time?**
A: No, payloads are stored locally. Fetch once, resend multiple times.

**Q: Can I resend the same message multiple times?**
A: Yes, as long as the payload is saved.

**Q: What happens if resend fails?**
A: The extension shows which messages failed. Check CPI logs for details.

**Q: Can I edit the payload before resending?**
A: Not currently. This is a planned feature.

**Q: Does this work with all iFlow types?**
A: Only iFlows with HTTP sender adapters and logged payloads.

**Q: How do I clear saved payloads?**
A: Clear browser data or use Chrome DevTools → Application → Storage.

**Q: Can I export payloads?**
A: Not currently. This is a planned feature.

**Q: Does this work offline?**
A: No, requires connection to SAP CPI.

**Q: Can multiple users share payloads?**
A: No, payloads are stored per browser/user.

**Q: What about large payloads (>1MB)?**
A: Should work, but may hit storage limits. Consider cleanup.
