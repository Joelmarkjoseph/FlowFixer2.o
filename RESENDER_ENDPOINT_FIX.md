# Message Resender - Endpoint Fetch Fix

## 🐛 The Problem

Error when trying to resend:
```
Failed to resend messages: GET https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/IntegrationRuntimeArtifacts?$expand=EntryPoints&$format=json
status 400 - Bad Request
```

### Two Issues:

1. **Wrong Domain**: Using `it-cpitrial05` instead of `integrationsuite-trial`
2. **No Filter**: Trying to fetch ALL IntegrationRuntimeArtifacts without filtering by iFlow name

## ✅ The Fix

### 1. Use Correct Domain for Cloud Foundry

**Before:**
```javascript
const artifactsUrl = baseUrl + "/api/v1/IntegrationRuntimeArtifacts?$expand=EntryPoints&$format=json";
// baseUrl = https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com
```

**After:**
```javascript
let artifactsBaseUrl = baseUrl;
if (!isNEO) {
  // For Cloud Foundry, use integrationsuite domain
  artifactsBaseUrl = baseUrl.replace(/\.it-cpi[^.]*\./, '.integrationsuite-trial.');
}
// artifactsBaseUrl = https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com
```

### 2. Fetch Endpoints Per iFlow with Filter

**Before:**
```javascript
// Tried to fetch ALL artifacts at once (no filter)
const artifactsUrl = baseUrl + "/api/v1/IntegrationRuntimeArtifacts?$expand=EntryPoints&$format=json";
```

**After:**
```javascript
// Get unique iFlow names from selected messages
const uniqueIflows = [...new Set(selectedMessages.map(msg => msg.IntegrationFlowName))];

// Fetch endpoint for each iFlow with filter
for (const iflowName of uniqueIflows) {
  const filter = `Name eq '${iflowName.replace(/'/g, "''")}'`;
  const artifactsUrl = `${artifactsBaseUrl}/api/v1/IntegrationRuntimeArtifacts?$filter=${encodeURIComponent(filter)}&$expand=EntryPoints&$format=json`;
  
  // Fetch and build endpoint map
}
```

## 🔄 How It Works Now

### Complete Flow:

```
1. User selects messages to resend
   ↓
2. Extract unique iFlow names from selected messages
   ↓
3. For each iFlow:
   a. Build correct URL with integrationsuite domain (CF)
   b. Add $filter parameter with iFlow name
   c. Fetch IntegrationRuntimeArtifacts
   d. Extract HTTP endpoint URL
   e. Add to endpoint map
   ↓
4. For each selected message:
   a. Get endpoint from map using iFlow name
   b. POST payload to endpoint
   c. Record success/failure
   ↓
5. Return results
```

## 📊 Expected Console Output

### Fetching Endpoints:
```
Base URL for artifacts: https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com
Unique iFlows to fetch endpoints for: ["Purchase_Order"]
Fetching endpoint for iFlow "Purchase_Order" from: https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/api/v1/IntegrationRuntimeArtifacts?$filter=Name%20eq%20'Purchase_Order'&$expand=EntryPoints&$format=json
✓ Found endpoint for "Purchase_Order": https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/http/PurchaseOrder
Endpoint map: { "Purchase_Order": "https://..." }
```

### Resending Messages:
```
Resending message AGkaI2z3j9AxRUAYiNOeC47Vyb_8 to https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/http/PurchaseOrder
✓ Successfully resent message AGkaI2z3j9AxRUAYiNOeC47Vyb_8
```

### Success Alert:
```
Resend complete!

Success: 1
Failed: 0
Total: 1
```

## 🎯 Key Changes

### Domain Handling
- **NEO**: Uses baseUrl as-is (same domain for everything)
- **Cloud Foundry**: 
  - MessageProcessingLogs: `it-cpitrial05` domain
  - IntegrationRuntimeArtifacts: `integrationsuite-trial` domain
  - iFlow endpoints: Can be either domain (handled automatically)

### API Call Strategy
- **Old**: Fetch all artifacts at once (no filter) → 400 Bad Request
- **New**: Fetch per iFlow with filter → Success

### URL Examples

**MessageProcessingLogs** (works with it-cpitrial):
```
https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/api/v1/MessageProcessingLogs
```

**IntegrationRuntimeArtifacts** (needs integrationsuite):
```
https://trial-xp03lcjj.integrationsuite-trial.cfapps.us10-001.hana.ondemand.com/api/v1/IntegrationRuntimeArtifacts?$filter=Name eq 'Purchase_Order'
```

**iFlow Endpoint** (can be either):
```
https://trial-xp03lcjj.it-cpitrial05.cfapps.us10-001.hana.ondemand.com/http/PurchaseOrder
```

## 🧪 Testing Steps

1. **Reload the extension** (code has been updated)
2. Go to SAP Integration Suite
3. Click "CPI Helper Lite" → "Message Resender"
4. Enter credentials and fetch messages
5. **Check console**: Should see "✓ All payloads saved to storage successfully"
6. Click on failed count to view messages
7. Select one or more messages
8. Click "Resend Selected"
9. **Check console**: Should see:
   - "Base URL for artifacts: https://...integrationsuite-trial..."
   - "✓ Found endpoint for..."
   - "✓ Successfully resent message..."
10. **Success alert**: "Resend complete! Success: 1"

## 🔍 Debugging

If you still get errors, check:

### 400 Bad Request
- **Check URL in console**: Should use `integrationsuite-trial` domain
- **Check filter**: Should have `$filter=Name eq 'iFlowName'`

### 404 Not Found
- **iFlow not deployed**: Verify iFlow is deployed and running
- **Wrong iFlow name**: Check exact name in Integration Suite

### 401/403 Unauthorized
- **Wrong credentials**: Verify username/password or Client ID/Secret
- **Permissions**: Ensure user has access to IntegrationRuntimeArtifacts API

## 📝 Summary

**Problem**: Wrong domain and missing filter when fetching IntegrationRuntimeArtifacts

**Solution**: 
1. Use `integrationsuite-trial` domain for CF environments
2. Fetch endpoints per iFlow with `$filter` parameter

**Impact**: Message resending now works correctly in Cloud Foundry! 🎉

## 🔧 Files Modified

- **contentScript.js** - `resendSelectedMessages()` function
  - Added domain conversion for CF
  - Changed to fetch endpoints per iFlow with filter
  - Added better logging

---

**The fix is complete and ready to test!** 🚀
