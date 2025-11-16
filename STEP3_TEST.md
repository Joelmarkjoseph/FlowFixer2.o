# Step 3 - Complete Resender Flow

## What This Does

The complete resender interface flow:

1. **Click "Resender Interface"** → Enter credentials
2. **iFlow Overview Screen** → Shows all iFlows with failed messages (last 15 mins)
3. **Click on failed count** → Shows failed messages for that iFlow
4. **Select messages** → Use checkboxes to select which messages to resend
5. **Click "Resend Selected"** → Fetches service endpoints and resends messages
6. **Alert shows results** → "X messages success / Y messages failed"

## The Complete Flow

```
1. Click "Resender Interface"
   ↓
2. Enter credentials (username, password, API URL)
   ↓
3. Extension fetches failed messages (last 15 mins)
   ↓
4. Groups by iFlow and shows overview:
   
   iFlow Overview (Last 15 mins)
   ┌─────────────────────────────┬──────────────┐
   │ iFlow Name                  │ Failed Count │
   ├─────────────────────────────┼──────────────┤
   │ OrderProcessing             │      5       │ ← Click here
   │ CustomerSync                │      3       │
   │ InvoiceGeneration           │      2       │
   └─────────────────────────────┴──────────────┘
   
   ↓
5. Click on failed count (e.g., "5")
   ↓
6. Shows failed messages screen:
   
   Failed Messages - OrderProcessing
   ┌───┬──────────────┬─────────┬──────────┬─────────┬────────┐
   │ ☐ │ Message GUID │ iFlow   │ LogStart │ Payload │ Status │
   ├───┼──────────────┼─────────┼──────────┼─────────┼────────┤
   │ ☑ │ ABC-123...   │ Order.. │ 10:30 AM │ ✓ Yes   │ FAILED │
   │ ☑ │ DEF-456...   │ Order.. │ 10:35 AM │ ✓ Yes   │ FAILED │
   │ ☐ │ GHI-789...   │ Order.. │ 10:40 AM │ ✗ No    │ FAILED │
   └───┴──────────────┴─────────┴──────────┴─────────┴────────┘
   
   [Select All] [Resend Selected (2)]
   
   ↓
7. Select messages with checkboxes
   ↓
8. Click "Resend Selected (2)"
   ↓
9. Confirmation: "Resend 2 message(s)?"
   ↓
10. Extension:
    a. Fetches integration runtime artifacts
       GET /api/v1/IntegrationRuntimeArtifacts?$expand=EntryPoints
    b. Finds endpoint URL for the iFlow
    c. POSTs payload to endpoint for each message
    d. Tracks success/failure
   ↓
11. Alert shows results:
    "Resend complete!
     Success: 2
     Failed: 0
     Total: 2"
```

## How to Test

### 1. Reload Extension
- Go to `chrome://extensions/`
- Click reload icon

### 2. Navigate to CPI
- Go to your SAP CPI tenant page

### 3. Open Console (Optional)
- Press F12 to see detailed logs
- Keep console open to watch the process

### 4. Click "Resender Interface"
- Find button in extension or left navigation

### 5. Enter Credentials
Dialog will appear:

**For Cloud Foundry:**
- **API URL**: `https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com`
- **Username**: Your SAP username
- **Password**: Your SAP password
- **Client ID**: (optional)
- **Client Secret**: (optional)

**For NEO:**
- **Username**: Your SAP username
- **Password**: Your SAP password

### 6. Click "Connect"

You should see:
- Status: "Fetching failed messages (last 15 mins)..."
- Then: "Found X iFlows with failed messages"

### 7. iFlow Overview Screen

You'll see a table with:
- iFlow names
- Failed message counts (clickable links)

### 8. Click on a Failed Count

Click on any number in the "Failed Count" column.

### 9. Failed Messages Screen

You'll see:
- List of failed messages
- Checkboxes (only enabled for messages with payloads)
- "Select All" button
- "Resend Selected (0)" button (disabled until you select)

### 10. Select Messages

- Click individual checkboxes, OR
- Click "Select All" button

Watch the button update: "Resend Selected (2)"

### 11. Click "Resend Selected"

- Confirmation dialog appears: "Resend 2 message(s)?"
- Click "OK"

### 12. Watch the Process

Status will show: "Resending..."

In console, you'll see:
```
Fetching service endpoints from: https://...
Service endpoints: [...]
Endpoint map: {...}
Resending message ABC-123 to https://...
✓ Successfully resent message ABC-123
Resending message DEF-456 to https://...
✓ Successfully resent message DEF-456
```

### 13. Results Alert

Alert will show:
```
Resend complete!

Success: 2
Failed: 0
Total: 2
```

## API Calls Made

### 1. Fetch Failed Messages
```
GET {baseUrl}/api/v1/MessageProcessingLogs?
  $select=MessageGuid,...
  &$filter=Status eq 'FAILED' and LogStart ge datetime'2025-11-16T...'
  &$orderby=LogStart
  &$format=json
```

### 2. Fetch Attachments (for each message)
```
GET {baseUrl}/api/v1/MessageProcessingLogs('MSG-GUID')/Attachments?$format=json
```

### 3. Fetch Payload (for each attachment)
```
GET {integrationsuiteUrl}/api/v1/MessageProcessingLogAttachments('ATT-ID')/$value
```

### 4. Fetch Integration Runtime Artifacts (iFlow Endpoints)
```
GET {baseUrl}/api/v1/IntegrationRuntimeArtifacts?
  $expand=EntryPoints
  &$format=json
```

### 5. Resend Message (for each selected message)
```
POST {endpointUrl}
Authorization: Basic {credentials}
Content-Type: application/xml
Body: {payload}
```

## Features

### ✓ Time Filter
- Only shows messages from last 15 minutes
- Calculated dynamically: `Date.now() - 15 * 60 * 1000`

### ✓ Grouped by iFlow
- Messages automatically grouped by IntegrationFlowName
- Shows count per iFlow

### ✓ Payload Validation
- Checkboxes only enabled for messages with payloads
- Messages without payloads show "✗ No" and can't be selected

### ✓ Select All
- Quickly select/deselect all messages with payloads
- Button toggles between "Select All" and "Deselect All"

### ✓ Dynamic Button
- "Resend Selected (X)" shows count
- Disabled when no messages selected

### ✓ Confirmation
- Asks for confirmation before resending
- Shows count of messages to be resent

### ✓ iFlow Endpoint Discovery
- Automatically fetches IntegrationRuntimeArtifacts
- Maps iFlow names to endpoint URLs
- Uses first HTTP entry point
- Handles missing endpoints gracefully

### ✓ Domain Switching (CF)
- Automatically uses integrationsuite domain for resending
- Replaces `it-cpitrial` with `integrationsuite-trial`

### ✓ Error Handling
- Tracks success/failure for each message
- Shows detailed results in alert
- Logs errors to console

### ✓ Navigation
- "Back" button on failed messages screen
- "Back to Overview" returns to iFlow list
- Can reload page to start over

## Troubleshooting

### No iFlows shown
- No failed messages in last 15 minutes
- Try triggering a failed message in CPI

### Checkbox disabled
- Message has no payload
- Payload fetch may have failed
- Check console for errors

### "No endpoint found for iFlow"
- Service endpoint not configured in CPI
- Check ServiceEndpoints API response in console

### Resend fails with 404
- Endpoint URL may be incorrect
- Check if domain switching is working (CF)
- Verify endpoint exists in CPI

### Resend fails with 401
- Credentials may be incorrect
- For CF, may need Client ID/Secret instead of username/password

### Alert shows all failed
- Check console for detailed error messages
- Verify endpoint URLs
- Check payload format

## What's Next?

This is the complete resender flow! You can now:

1. ✅ View failed messages (last 15 mins)
2. ✅ Group by iFlow
3. ✅ Select messages
4. ✅ Resend to endpoints
5. ✅ See success/failure results

If you want to add more features:
- Store payloads in Chrome storage for offline resending
- Add date range filter
- Export/import payloads
- Retry failed resends
- Schedule automatic resends
- Add payload preview
- Filter by specific iFlow

Let me know what you'd like to add! 🚀
