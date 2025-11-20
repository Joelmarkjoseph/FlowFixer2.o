# Supabase Integration Testing Guide

## ✅ What's Implemented

1. **Company Code Field** - Added to auth dialog
2. **Sync on Resend** - Messages synced to Supabase when successfully resent
3. **Fetch on Refresh** - Statuses fetched from Supabase every 5 minutes
4. **Green Highlighting** - Based on both local IndexedDB and Supabase data
5. **Multi-User Support** - Multiple users can see each other's resent messages

## 🧪 Testing Steps

### Test 1: Single User - Basic Sync

1. **Setup:**
   - Reload extension
   - Click "Resender" button
   - Enter credentials:
     - Company Code: `TEST01`
     - Username: your SAP username
     - Password: your SAP password
     - (Other fields as needed)

2. **Resend a Message:**
   - Select a failed message
   - Click "Resend Selected"
   - Wait for success

3. **Verify Supabase:**
   - Go to Supabase dashboard
   - Check `resent_messages` table
   - Should see new row with:
     - `company_code`: TEST01
     - `message_guid`: (your message ID)
     - `status`: Resent
     - `resent_at`: timestamp

4. **Verify UI:**
   - Message should show green background
   - Status should say "Resent"

### Test 2: Multi-User - Shift Handover

**User A (First Shift):**
1. Login with Company Code: `TEST01`
2. Resend message MS1
3. Verify MS1 shows green
4. Close browser/end shift

**User B (Second Shift):**
1. Login with Company Code: `TEST01` (same code!)
2. Click "Manual Fetch" or wait 5 minutes
3. **Expected:** MS1 shows green (even though User B didn't resend it)
4. This proves Supabase sync is working!

### Test 3: Auto-Refresh

1. Login and view messages
2. Wait 5 minutes
3. **Expected:** Console shows:
   ```
   Auto-refresh: Fetching updated messages...
   Fetching resent statuses from Supabase...
   ✓ Fetched X resent messages from Supabase
   ```
4. Green highlighting updates automatically

### Test 4: Offline Mode

1. Login and resend a message
2. Disconnect internet
3. **Expected:** Message still shows green (from local IndexedDB)
4. Reconnect internet
5. Wait 5 minutes for auto-refresh
6. **Expected:** Syncs to Supabase

### Test 5: Different Companies

**Company A:**
1. Login with Company Code: `COMPANYA`
2. Resend message MS1

**Company B:**
1. Login with Company Code: `COMPANYB`
2. **Expected:** MS1 does NOT show green
3. This proves company isolation works!

## 🔍 Debugging

### Check Console Logs

**On Resend:**
```
✓ Marked X messages as resent in IndexedDB
✓ Synced X messages to Supabase
```

**On Fetch:**
```
Fetching resent statuses from Supabase...
✓ Fetched X resent messages from Supabase
Found X total resent message GUIDs (will mark as green)
```

### Check Supabase Table

```sql
-- View all records
SELECT * FROM resent_messages ORDER BY created_at DESC;

-- View by company
SELECT * FROM resent_messages WHERE company_code = 'TEST01';

-- Count by company
SELECT company_code, COUNT(*) FROM resent_messages GROUP BY company_code;
```

### Check Network Tab

1. Open DevTools → Network
2. Filter: `supabase`
3. Should see:
   - POST requests when resending (upsert)
   - GET requests on refresh (fetch)

## ⚠️ Troubleshooting

### "Supabase sync skipped"
**Cause:** No company code entered
**Fix:** Re-enter credentials with company code

### "Failed to sync to Supabase"
**Cause:** Network error or Supabase down
**Fix:** Check internet connection, verify Supabase is accessible

### Messages not showing green for other users
**Cause:** Different company codes
**Fix:** Ensure all users use the SAME company code

### Duplicate entries in Supabase
**Cause:** Should not happen (UNIQUE constraint)
**Fix:** If it does, check the constraint is working

## 📊 Expected Behavior

| Action | Local IndexedDB | Supabase | UI |
|--------|----------------|----------|-----|
| Resend Success | ✅ Updated | ✅ Synced | 🟢 Green |
| Auto-Refresh | ✅ Checked | ✅ Fetched | 🟢 Green |
| Manual Fetch | ✅ Checked | ✅ Fetched | 🟢 Green |
| Offline | ✅ Works | ❌ Skipped | 🟢 Green (local) |
| Different Company | ✅ Separate | ✅ Isolated | ⚪ Not green |

## 🎯 Success Criteria

✅ Company code field appears in auth dialog
✅ Messages sync to Supabase on successful resend
✅ Green highlighting works from Supabase data
✅ Multiple users see each other's resent messages
✅ Auto-refresh fetches from Supabase every 5 minutes
✅ Company isolation works (different codes = different data)
✅ Offline mode still works (falls back to local)

## 🚀 Next Steps

Once testing is complete:
1. Document company code for your team
2. Train users on entering company code
3. Monitor Supabase usage/limits
4. Consider adding user-level authentication (future)
