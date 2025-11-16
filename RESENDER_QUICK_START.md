# Message Resender - Quick Start Guide

## 🚀 Quick Start (5 Minutes)

### For NEO Environment

1. **Open CPI Helper Lite**
   - Navigate to SAP Integration Suite
   - Click "CPI Helper Lite" in left navigation
   - Click "Message Resender" button

2. **Fetch Payloads**
   - Find an iFlow with failed messages
   - Click "Fetch Payloads" button
   - Wait for "Successfully saved X messages with payloads"

3. **Resend Messages**
   - Click the blue "Failed Count" number
   - Select messages (checkboxes)
   - Click "Resend Selected (X)"
   - Confirm and wait for completion

4. **Verify**
   - Check iFlow message monitoring
   - Look for newly processed messages

### For Cloud Foundry Environment

1. **Configure First** (one-time setup)
   - Open extension popup
   - Click "Configure Resender"
   - Enter:
     - API URL: `https://[tenant].integrationsuite-trial.cfapps.[region].hana.ondemand.com`
     - Username: Your BTP username
     - Password: Your BTP password
     - Client ID: OAuth client ID
     - Client Secret: OAuth client secret
   - Click "Save"

2. **Follow NEO steps 1-4 above**

## 📋 What Each Button Does

### "Fetch Payloads" Button
- Downloads failed message payloads from SAP
- Saves them to browser storage
- Required before you can resend

### "Select All" Button
- Selects/deselects all messages with saved payloads
- Only enabled messages can be selected

### "Resend Selected (X)" Button
- Sends selected messages back to the iFlow
- Shows progress in real-time
- Displays success/failure summary

## ⚡ Common Workflows

### Workflow 1: Resend All Failed Messages
```
1. Click "Fetch Payloads" → Wait
2. Click "Failed Count" link
3. Click "Select All"
4. Click "Resend Selected"
5. Confirm → Done!
```

### Workflow 2: Resend Specific Messages
```
1. Click "Fetch Payloads" → Wait
2. Click "Failed Count" link
3. Check specific message checkboxes
4. Click "Resend Selected"
5. Confirm → Done!
```

### Workflow 3: Bulk Resend Multiple iFlows
```
1. Click "Fetch All Payloads" → Wait for all
2. For each iFlow:
   - Click "Failed Count"
   - Select messages
   - Resend
   - Go back
```

## 🎯 Status Messages Explained

| Status Message | Meaning |
|---------------|---------|
| "Fetching failed messages..." | Getting list of failed messages |
| "Found X failed messages, fetching payloads..." | Downloading message content |
| "Processing X/Y: [id]..." | Downloading payload for message X of Y |
| "Successfully saved X messages with payloads" | ✅ Payloads ready to resend |
| "Fetching iFlow endpoint..." | Getting iFlow URL |
| "Resending X/Y: [id]..." | Sending message X of Y |
| "Completed: X/Y messages resent successfully" | ✅ Done! X succeeded, Y total |
| "Error: [message]" | ❌ Something went wrong |

## 🔧 Quick Troubleshooting

### Problem: Button says "Resend Selected (0)"
**Fix**: Select some messages first (click checkboxes)

### Problem: All checkboxes are disabled
**Fix**: Click "Fetch Payloads" first to download message content

### Problem: "No saved payloads found"
**Fix**: Go back and click "Fetch Payloads" for that iFlow

### Problem: "API URL is required" (CF only)
**Fix**: Configure resender in popup settings first

### Problem: "No endpoint found for iFlow"
**Fix**: Make sure the iFlow is deployed and running

### Problem: Authentication error (401/403)
**Fix**: 
- NEO: Check username/password
- CF: Check Client ID/Secret in settings

## 💡 Pro Tips

1. **Test with one message first** - Select and resend a single message to verify everything works

2. **Check the console** - Press F12 to see detailed logs if something goes wrong

3. **Don't resend too many at once** - Start with small batches (10-20 messages)

4. **Verify in monitoring** - Always check the iFlow's message monitoring after resending

5. **Save credentials** - The extension remembers your configuration

6. **Reload if needed** - If you see "Extension context invalidated", just reload the page

## 📊 What Success Looks Like

### Fetch Payloads Success
```
Status: "Successfully saved 15 messages with payloads"
Saved Payloads column: Shows "15"
```

### Resend Success
```
Status: "Completed: 15/15 messages resent successfully"
Alert: "Successfully resent 15/15 messages"
iFlow monitoring: Shows new messages being processed
```

### Partial Success (Some Failed)
```
Status: "Completed: 12/15 messages resent successfully"
Alert: "Successfully resent 12/15 messages"
Check console for details on which 3 failed
```

## 🎬 Video Tutorial Steps

If you're creating a video tutorial, follow this script:

1. **Intro** (10 sec)
   - "Today I'll show you how to resend failed messages in SAP CPI"

2. **Setup** (30 sec)
   - Show extension installed
   - Navigate to Integration Suite
   - Click "CPI Helper Lite"
   - Click "Message Resender"

3. **Fetch** (30 sec)
   - Point to iFlow with failed messages
   - Click "Fetch Payloads"
   - Show status updates
   - Show "Saved Payloads" count update

4. **Resend** (45 sec)
   - Click "Failed Count" link
   - Show message details table
   - Select messages
   - Click "Resend Selected"
   - Show progress
   - Show success alert

5. **Verify** (30 sec)
   - Go to message monitoring
   - Show newly processed messages
   - Point out success status

6. **Outro** (15 sec)
   - "That's it! Quick and easy message resending"

Total: ~2.5 minutes

## 📝 Checklist for First-Time Users

Before you start:
- [ ] Extension is installed and enabled
- [ ] You have access to SAP Integration Suite
- [ ] You know your credentials (username/password or Client ID/Secret)
- [ ] You have at least one iFlow with failed messages
- [ ] (CF only) You've configured the API URL in settings

First resend:
- [ ] Opened Message Resender interface
- [ ] Clicked "Fetch Payloads" for an iFlow
- [ ] Waited for "Successfully saved" message
- [ ] Clicked "Failed Count" to view messages
- [ ] Selected one message
- [ ] Clicked "Resend Selected (1)"
- [ ] Confirmed the action
- [ ] Saw "Successfully resent 1/1 messages"
- [ ] Verified in iFlow message monitoring

If all checkboxes are checked, you're ready to use the feature! 🎉

## 🆘 Need More Help?

- **Detailed Testing**: See `RESENDER_TEST_GUIDE.md`
- **Technical Details**: See `RESENDER_FIXES_SUMMARY.md`
- **Architecture**: See `ARCHITECTURE.md`
- **Console Logs**: Press F12 and check Console tab for detailed debugging info

## 🔗 Related Features

- **Message Overview**: View all iFlows and their message counts
- **Failed Message Details**: See error details for each failed message
- **Attachment Fetching**: Automatically downloads message payloads
- **Batch Operations**: Process multiple messages at once
