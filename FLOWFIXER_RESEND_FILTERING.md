# FlowFixer Resend Message Filtering

## Overview
FlowFixer now automatically filters out resent messages from the display, showing only actual business failures. This prevents confusion during shift handovers and ensures operators only see genuine failures.

## How It Works

### 1. Resending Process
When FlowFixer resends a message, it adds a custom HTTP header:
```
X-FlowFixer-Resend: true
```

### 2. iFlow Groovy Script
Your iFlow must include this Groovy script to capture the header and add a marker attachment:

```groovy
import com.sap.gateway.ip.core.customdev.util.Message;

def Message processData(Message message) {
    def body = message.getBody(java.lang.String) as String;
    def messageLog = messageLogFactory.getMessageLog(message);
    
    if (messageLog != null) {
        messageLog.setStringProperty("Logging", "Printing Payload as Attachment");
        messageLog.addAttachmentAsString("ResponsePayload", body, "text/plain");
        
        // Check if this is a FlowFixer resend
        def headers = message.getHeaders();
        def isFlowFixerResend = headers.get("X-FlowFixer-Resend");
        
        if (isFlowFixerResend == "true") {
            // Add marker attachment that FlowFixer can detect
            messageLog.addAttachmentAsString(
                "FlowFixerResendInfo", 
                "This message was resent by FlowFixer at " + new Date().toString(), 
                "text/plain"
            );
        }
    }
    
    return message;
}
```

### 3. Extension Filtering
FlowFixer automatically:
- Fetches failed messages from MessageProcessingLogs API
- For each message, checks Attachments for `FlowFixerResendInfo` marker
- Filters out any messages with the FlowFixer marker attachment
- Displays only genuine business failures

## Setup Instructions

### Step 1: Add Groovy Script to iFlow
1. Open your iFlow in SAP CPI
2. Add a **Script** step (Groovy Script) after the sender adapter
3. Paste the Groovy script above
4. Save and deploy the iFlow

### Step 2: Test the Filtering
1. Open FlowFixer extension
2. Select a failed message and resend it
3. Wait for the resent message to process
4. Click "Manual Fetch" to refresh
5. **The resent message should NOT appear** in the list

## Verification

### Check Console Logs
Open browser DevTools (F12) and look for:
```
✓ Filtering out FlowFixer resent message: <MessageGuid>
```

### Check Message Attachments in CPI
1. Go to Monitor → Message Processing Logs
2. Find a resent message
3. Click on it → Attachments tab
4. Look for attachment: `FlowFixerResendInfo`

## Benefits

✅ **Clean Interface**: Only see actual business failures
✅ **No Duplicate Work**: Avoid resending already-resent messages
✅ **Shift Handover**: Next shift sees only unresolved issues
✅ **Audit Trail**: Resent messages are marked but hidden from view
✅ **Performance**: Fewer messages to display = faster loading

## Troubleshooting

### Resent messages still appear
**Cause**: Groovy script not deployed or not executing
**Solution**: 
- Verify Groovy script is in the iFlow
- Check script is placed after sender adapter
- Redeploy the iFlow

### Marker attachment not found
**Cause**: Message processed before Groovy script was added
**Solution**: 
- Only new messages will have the marker attachment
- Old resent messages may still appear (one-time issue)

### Filtering too slow
**Cause**: Checking attachments for each message adds API calls
**Solution**: 
- This is expected behavior (one API call per message)
- Typically adds 100-200ms per message
- Consider reducing "Days Back" to 1 for faster loading
- Note: We already fetch attachments for payloads, so minimal extra overhead

## Technical Details

### API Endpoint Used
```
GET /api/v1/MessageProcessingLogs('<MessageGuid>')/Attachments?$format=json
```

### Response Structure
```json
{
  "d": {
    "results": [
      {
        "Id": "abc123",
        "Name": "ResponsePayload",
        "ContentType": "text/plain"
      },
      {
        "Id": "def456",
        "Name": "FlowFixerResendInfo",
        "ContentType": "text/plain"
      }
    ]
  }
}
```

### Filtering Logic
```javascript
// For each message log
const attachmentsUrl = `${baseUrl}/api/v1/MessageProcessingLogs('${messageGuid}')/Attachments`;
const attachments = await fetchAttachments(attachmentsUrl);

// Check if FlowFixerResendInfo attachment exists
const isResent = attachments.find(att => 
  att.Name === 'FlowFixerResendInfo'
);

// Exclude resent messages
if (!isResent) {
  displayMessage(log);
}
```

## Notes

- The `X-FlowFixer-Resend` header is sent with **every** resend operation
- The Groovy script must be in **every iFlow** you want to filter
- The marker attachment is stored permanently in the message log
- Filtering happens during message fetch, not during display
- If attachment fetch fails, the message is included (fail-safe)
- The attachment check reuses the same API call we make for payload fetching (efficient!)
