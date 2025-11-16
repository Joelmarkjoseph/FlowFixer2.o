# Testing Guide for SAP CPI Message Resender

## Pre-Testing Checklist

Before testing, ensure you have:
- [ ] Chrome browser (version 88+)
- [ ] Access to SAP CPI tenant (NEO or Cloud Foundry)
- [ ] Valid credentials with appropriate permissions
- [ ] At least one iFlow with failed messages
- [ ] iFlow has HTTP sender adapter configured
- [ ] iFlow logs initial payload in attachments

## Installation Test

### 1. Load Extension

```bash
# Steps:
1. Open Chrome
2. Navigate to chrome://extensions/
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked"
5. Select the extension folder
```

**Expected Result:**
- ✅ Extension loads without errors
- ✅ Extension icon appears in toolbar
- ✅ No errors in chrome://extensions/

**If Failed:**
- Check manifest.json syntax
- Verify all files are present
- Check browser console for errors

### 2. Verify Files

```bash
# Required files:
manifest.json
background.js
contentScript.js
resender_functions.js  # NEW
resender_ui.js         # NEW
popup.html
popup.js
lib/xmlToJson/xmlToJson.js
```

**Expected Result:**
- ✅ All files present
- ✅ No syntax errors

## Functional Tests

### Test 1: Basic Extension Load

**Steps:**
1. Navigate to your SAP CPI tenant
2. Wait for page to load completely
3. Open browser console (F12)

**Expected Result:**
- ✅ No JavaScript errors in console
- ✅ Extension scripts loaded
- ✅ Console shows: "CPI Helper Lite content script loaded"

**Console Commands to Verify:**
```javascript
// Check if functions are defined
typeof fetchMessageAttachments !== 'undefined'  // Should be true
typeof renderResenderOverview !== 'undefined'   // Should be true
typeof state !== 'undefined'                    // Should be true
```

### Test 2: Message Overview

**Steps:**
1. Click extension icon or find "CPI Helper Lite" in left nav
2. Click "Get Message Overview" button
3. Wait for loading to complete

**Expected Result:**
- ✅ Status shows "Loading..."
- ✅ Table populates with iFlows
- ✅ Completed counts shown in green
- ✅ Failed counts shown in red
- ✅ Status shows "Loaded X iFlows"

**If Failed:**
- Check network tab for API errors
- Verify you're logged into CPI
- Check console for JavaScript errors

### Test 3: Resender Interface - Authentication

**Steps:**
1. Click "Resender Interface" button
2. Dialog should appear

**For NEO:**
```
Expected fields:
- Username
- Password
```

**For Cloud Foundry:**
```
Expected fields:
- API URL
- Username
- Password
- Client ID
- Client Secret
```

**Expected Result:**
- ✅ Dialog appears with correct fields
- ✅ Saved credentials pre-filled (if any)
- ✅ Can enter credentials
- ✅ "Connect" button works

**Test Credentials:**
```javascript
// In browser console, check saved credentials:
chrome.storage.local.get([
  'resenderUsername',
  'resenderPassword',
  'resenderApiUrl',
  'resenderClientId',
  'resenderClientSecret'
], (result) => console.log(result));
```

### Test 4: Fetch Payloads - Single iFlow

**Steps:**
1. In Resender Interface, find an iFlow with failed messages
2. Click "Fetch Payloads" button for that iFlow
3. Watch status bar

**Expected Result:**
- ✅ Status shows "Fetching failed messages for {iFlowName}..."
- ✅ Status shows "Found X failed messages"
- ✅ Status shows "Processing message 1/X..."
- ✅ Status shows "Saved X payloads for {iFlowName}"
- ✅ "Saved Payloads" column updates

**Console Verification:**
```javascript
// Check if payloads were saved
chrome.storage.local.get(null, (items) => {
  const payloads = Object.keys(items).filter(k => k.startsWith('payload_'));
  console.log('Saved payloads:', payloads.length);
  console.log('Payload keys:', payloads);
});
```

**If Failed:**
- Check network tab for API errors (401, 403, 404)
- Verify iFlow has failed messages
- Verify messages have attachments
- Check console for errors

### Test 5: Fetch All Payloads

**Steps:**
1. Click "Fetch All Payloads" button
2. Watch status bar

**Expected Result:**
- ✅ Status shows "Processing 1/X: {iFlowName}..."
- ✅ Progresses through all iFlows
- ✅ Status shows "All payloads fetched successfully!"
- ✅ All "Saved Payloads" counts update

**Performance Check:**
```javascript
// Time the operation
console.time('fetchAll');
// Click "Fetch All Payloads"
// After completion:
console.timeEnd('fetchAll');
// Should be reasonable (e.g., < 5 minutes for 100 messages)
```

### Test 6: View Failed Messages

**Steps:**
1. Click on a failed count (red number)
2. Wait for message list to load

**Expected Result:**
- ✅ Back button appears
- ✅ Title shows "Failed Messages — {iFlowName}"
- ✅ Table shows messages with:
  - Checkbox (enabled if payload saved)
  - Message ID
  - Status
  - Timestamp
  - Payload status (✓ Saved or ✗ Not saved)
  - Error details
- ✅ "Select All" button present
- ✅ "Resend Selected (0)" button present (disabled)

**Verify Data:**
```javascript
// Check message data in console
document.querySelectorAll('.message-checkbox').forEach(cb => {
  console.log('Message:', cb.getAttribute('data-message-id'), 'Enabled:', !cb.disabled);
});
```

### Test 7: Message Selection

**Steps:**
1. Click checkbox for one message
2. Click "Select All" button
3. Click "Select All" again (to deselect)
4. Manually select 2-3 messages

**Expected Result:**
- ✅ Individual checkbox toggles correctly
- ✅ "Select All" selects all enabled checkboxes
- ✅ "Select All" again deselects all
- ✅ "Resend Selected (X)" button updates count
- ✅ Button enables when count > 0
- ✅ Button disables when count = 0

**Console Verification:**
```javascript
// Check selected count
const selected = document.querySelectorAll('.message-checkbox:checked');
console.log('Selected messages:', selected.length);
```

### Test 8: Resend Messages - Single

**Steps:**
1. Select ONE message with saved payload
2. Click "Resend Selected (1)" button
3. Confirm in dialog
4. Wait for completion

**Expected Result:**
- ✅ Confirmation dialog appears
- ✅ Status shows "Fetching endpoint for {iFlowName}..."
- ✅ Status shows "Resending message 1/1..."
- ✅ Status shows "Resent 1/1 messages successfully"
- ✅ Success alert appears
- ✅ Button re-enables

**Verify in CPI:**
1. Open CPI monitoring in another tab
2. Navigate to Message Monitoring
3. Filter by iFlow name
4. Look for new message with recent timestamp
5. Verify message processed successfully

**Console Verification:**
```javascript
// Check network tab for POST request to iFlow endpoint
// Should see:
// - POST to iFlow URL
// - Status 200 or 202
// - Response body (if any)
```

### Test 9: Resend Messages - Bulk

**Steps:**
1. Select 3-5 messages with saved payloads
2. Click "Resend Selected (X)" button
3. Confirm in dialog
4. Wait for completion

**Expected Result:**
- ✅ Status shows progress for each message
- ✅ Status shows "Resent X/Y messages successfully"
- ✅ Success alert shows correct counts
- ✅ All messages appear in CPI monitoring

**Performance Check:**
```javascript
// Time the operation
console.time('resendBulk');
// Click "Resend Selected"
// After completion:
console.timeEnd('resendBulk');
// Should be ~1-2 seconds per message
```

### Test 10: Error Handling

**Test 10a: Wrong Credentials**

**Steps:**
1. Clear saved credentials
2. Click "Resender Interface"
3. Enter wrong username/password
4. Try to fetch payloads

**Expected Result:**
- ✅ Error message shows "Authentication failed"
- ✅ Status shows 401 or 403 error
- ✅ No crash or undefined errors

**Test 10b: No Payloads**

**Steps:**
1. View failed messages for an iFlow
2. Don't fetch payloads
3. Try to select and resend

**Expected Result:**
- ✅ Checkboxes are disabled
- ✅ Can't select messages
- ✅ "Resend Selected" button stays disabled

**Test 10c: Network Error**

**Steps:**
1. Open DevTools → Network tab
2. Enable "Offline" mode
3. Try to fetch payloads

**Expected Result:**
- ✅ Error message shows network error
- ✅ No crash or undefined errors
- ✅ Can retry after going online

**Test 10d: No Endpoint**

**Steps:**
1. Try to resend message for iFlow with no HTTP adapter

**Expected Result:**
- ✅ Error message shows "No endpoint found"
- ✅ Specific error details in console
- ✅ No crash

### Test 11: Storage Management

**Check Storage Usage:**
```javascript
// Get storage usage
chrome.storage.local.getBytesInUse(null, (bytes) => {
  console.log('Storage used:', bytes, 'bytes');
  console.log('Storage used:', (bytes / 1024).toFixed(2), 'KB');
  console.log('Storage used:', (bytes / 1024 / 1024).toFixed(2), 'MB');
});
```

**List All Payloads:**
```javascript
// List all saved payloads
chrome.storage.local.get(null, (items) => {
  const payloads = Object.entries(items)
    .filter(([key]) => key.startsWith('payload_'))
    .map(([key, value]) => ({
      key,
      iflow: value.iflowName,
      messageGuid: value.messageGuid,
      size: JSON.stringify(value).length,
      savedAt: value.metadata?.savedAt
    }));
  
  console.table(payloads);
  console.log('Total payloads:', payloads.length);
  console.log('Total size:', payloads.reduce((sum, p) => sum + p.size, 0), 'bytes');
});
```

**Clear Specific Payload:**
```javascript
// Clear payload for specific message
const key = 'payload_IFlowName_MessageGuid';
chrome.storage.local.remove(key, () => {
  console.log('Removed:', key);
});
```

**Clear All Payloads:**
```javascript
// Clear all payloads (use with caution!)
chrome.storage.local.get(null, (items) => {
  const payloadKeys = Object.keys(items).filter(k => k.startsWith('payload_'));
  chrome.storage.local.remove(payloadKeys, () => {
    console.log('Removed', payloadKeys.length, 'payloads');
  });
});
```

### Test 12: Cross-Origin Requests

**For Cloud Foundry (different subdomains):**

**Steps:**
1. Navigate to CPI tenant on one subdomain
2. Configure API URL pointing to different subdomain
3. Try to fetch payloads

**Expected Result:**
- ✅ Background script handles CORS
- ✅ Requests succeed
- ✅ Console shows "Using background script for cross-origin request"

**Console Verification:**
```javascript
// Check background script logs
// Open extension page: chrome://extensions/
// Click "service worker" link under extension
// Check console for background script logs
```

## Integration Tests

### Test 13: End-to-End Workflow

**Complete workflow test:**

1. ✅ Open CPI tenant
2. ✅ Click "Resender Interface"
3. ✅ Enter credentials
4. ✅ Click "Fetch All Payloads"
5. ✅ Wait for completion
6. ✅ Click failed count for an iFlow
7. ✅ Select 3 messages
8. ✅ Click "Resend Selected (3)"
9. ✅ Confirm
10. ✅ Wait for completion
11. ✅ Verify in CPI monitoring
12. ✅ Check all 3 messages processed

**Time the entire workflow:**
```javascript
console.time('e2e');
// Perform all steps
console.timeEnd('e2e');
// Should complete in reasonable time (< 10 minutes)
```

## Performance Tests

### Test 14: Large Dataset

**Test with many messages:**

**Steps:**
1. Find iFlow with 50+ failed messages
2. Click "Fetch Payloads"
3. Monitor performance

**Expected Result:**
- ✅ Completes without timeout
- ✅ No memory leaks
- ✅ UI remains responsive
- ✅ Progress updates regularly

**Monitor Performance:**
```javascript
// Before fetching
console.log('Memory:', performance.memory);

// After fetching
console.log('Memory:', performance.memory);

// Check for memory leaks
// usedJSHeapSize should not grow excessively
```

### Test 15: Concurrent Operations

**Test multiple operations:**

**Steps:**
1. Start "Fetch All Payloads"
2. While running, try to view messages
3. Try to resend messages

**Expected Result:**
- ✅ Operations queue properly
- ✅ No race conditions
- ✅ No data corruption
- ✅ UI shows appropriate status

## Browser Compatibility

### Test 16: Chrome

- ✅ Chrome 88+
- ✅ Chrome 100+
- ✅ Chrome latest

### Test 17: Edge

- ✅ Edge 88+ (Chromium-based)
- ✅ Edge latest

## Regression Tests

After any code changes, re-run:

- [ ] Test 1: Basic Extension Load
- [ ] Test 2: Message Overview
- [ ] Test 3: Authentication
- [ ] Test 8: Resend Single Message
- [ ] Test 9: Resend Bulk Messages
- [ ] Test 10: Error Handling
- [ ] Test 13: End-to-End Workflow

## Test Report Template

```markdown
# Test Report

**Date:** YYYY-MM-DD
**Tester:** [Name]
**Environment:** [NEO/CF]
**Chrome Version:** [Version]

## Test Results

| Test | Status | Notes |
|------|--------|-------|
| Installation | ✅/❌ | |
| Message Overview | ✅/❌ | |
| Authentication | ✅/❌ | |
| Fetch Payloads | ✅/❌ | |
| View Messages | ✅/❌ | |
| Message Selection | ✅/❌ | |
| Resend Single | ✅/❌ | |
| Resend Bulk | ✅/❌ | |
| Error Handling | ✅/❌ | |
| Storage | ✅/❌ | |
| Cross-Origin | ✅/❌ | |
| End-to-End | ✅/❌ | |
| Performance | ✅/❌ | |

## Issues Found

1. [Issue description]
2. [Issue description]

## Performance Metrics

- Fetch 10 payloads: X seconds
- Resend 10 messages: X seconds
- Storage used: X MB

## Recommendations

[Any recommendations for improvements]
```

## Automated Testing (Future)

Consider adding:
- Unit tests for core functions
- Integration tests with mock API
- E2E tests with Puppeteer/Playwright
- Performance benchmarks
- Load testing

## Debugging Tips

### Enable Verbose Logging

```javascript
// Add to contentScript.js
const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log('[CPI Resender]', ...args);
}

// Use throughout code:
log('Fetching payloads for', iflowName);
```

### Monitor Network Requests

```javascript
// In DevTools Console
// Monitor all fetch requests
const originalFetch = window.fetch;
window.fetch = function(...args) {
  console.log('Fetch:', args[0]);
  return originalFetch.apply(this, args);
};
```

### Inspect Storage

```javascript
// View all storage
chrome.storage.local.get(null, (items) => {
  console.log('All storage:', items);
});

// Watch for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  console.log('Storage changed:', changes);
});
```

## Success Criteria

Extension is ready for production when:

- ✅ All functional tests pass
- ✅ No console errors
- ✅ Performance is acceptable
- ✅ Error handling works correctly
- ✅ Storage management works
- ✅ Cross-origin requests work
- ✅ End-to-end workflow completes successfully
- ✅ Messages successfully resent and processed in CPI
- ✅ No data loss or corruption
- ✅ UI is responsive and intuitive

## Next Steps After Testing

1. Document any issues found
2. Fix critical bugs
3. Optimize performance if needed
4. Add any missing error handling
5. Update documentation
6. Prepare for deployment
7. Train users
8. Monitor production usage

---

**Happy Testing! 🧪**
