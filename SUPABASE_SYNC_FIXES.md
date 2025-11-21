# Supabase Sync Fixes - FlowFixer

## Issues Fixed

### 1. ✅ Checkbox Disabled Issue
**Problem**: Checkboxes were getting disabled because of missing payload status.

**Solution**: 
- Removed `!msg.payload` check from checkbox disable condition
- Now checkboxes are only disabled if message was already resent
- Changed payload status display from "Yes/No" to "FOD/No" (Fetched On Demand)

```javascript
// Before
checkbox.disabled = !msg.payload || msg.resentSuccessfully;
tdPayload.textContent = msg.payload ? 'Yes' : 'No';

// After
checkbox.disabled = msg.resentSuccessfully; // Only disable if already resent
tdPayload.textContent = (msg.hasPayload || msg.attachments?.length > 0) ? 'FOD' : 'No';
```

---

### 2. ✅ Supabase Sync - Only Resent Messages
**Problem**: When resending messages, the system was syncing ALL message logs to Supabase instead of just the newly resent message GUIDs.

**Solution**: 
- Modified `markMessagesAsResent()` to only sync newly resent messages
- Modified `syncAllLocalToSupabase()` to only sync resent messages from IndexedDB (not all failed messages)

```javascript
// markMessagesAsResent() - Only syncs newly resent messages
const messages = messageGuids.map(guid => ({
  companyCode: companyCode,
  messageGuid: guid,
  iflowName: iflowName,
  status: 'Resent',
  resentAt: new Date().toISOString(),
  resentBy: username || companyCode
}));

await supabaseHelper.upsertMultipleResentMessages(messages);
console.log(`✓ Synced only ${messageGuids.length} newly resent messages to Supabase`);
```

---

### 3. ✅ 2-Minute Status Sync Timer
**Problem**: The 2-minute status sync timer was failing due to:
- Trying to match truncated message GUIDs (only first 36 chars shown in table)
- Not handling missing supabaseHelper gracefully
- Not checking if table rows exist

**Solution**: 
- Use checkbox `dataset.messageGuid` (full GUID) instead of truncated text
- Added proper error handling and availability checks
- Added check for table rows existence
- Only update rows that actually changed
- Update "Last synced" timestamp

```javascript
// Get full message GUID from checkbox dataset
const checkbox = row.querySelector('.message-checkbox');
if (checkbox && checkbox.dataset.messageGuid) {
  const messageGuid = checkbox.dataset.messageGuid; // Full GUID
  
  if (resentGuidsSet.has(messageGuid)) {
    // Update row styling
    row.style.backgroundColor = '#d4edda';
    row.style.borderLeft = '4px solid #28a745';
    updatedCount++;
  }
}

console.log(`✓ Status sync: Updated ${updatedCount} rows with latest statuses`);
```

---

## Benefits

### Performance
- **Reduced API calls**: Only syncing resent messages (not all failed messages)
- **Faster sync**: Smaller payload = faster network transfer
- **Less database load**: Fewer records to upsert

### Reliability
- **Better error handling**: Graceful fallback if Supabase is unavailable
- **Accurate matching**: Using full message GUIDs instead of truncated text
- **Non-blocking**: Sync failures don't break the UI

### User Experience
- **All checkboxes enabled**: Users can select any message to resend
- **Clear status**: "FOD" indicates payload will be fetched on demand
- **Real-time updates**: 2-minute sync keeps UI in sync across users
- **Visual feedback**: "Last synced" timestamp shows when data was updated

---

## New Feature: Manual Sync Button

Added a **"Sync Status"** button to the messages screen that allows users to manually trigger a Supabase sync to update message statuses.

### Features
- **On-demand sync**: Click to immediately fetch latest statuses from Supabase
- **Visual feedback**: Shows "Syncing...", "✓ Synced (X updated)", or error messages
- **Smart updates**: Only updates rows that changed status
- **Error handling**: Gracefully handles missing Supabase or company code
- **Auto-hide status**: Status message disappears after 3 seconds

### Location
The button is located in the messages screen (when viewing messages for a specific iFlow), on the right side of the controls bar.

### Usage
1. Navigate to a specific iFlow's messages
2. Click the **"Sync Status"** button
3. Wait for sync to complete (shows count of updated rows)
4. Green rows indicate messages that were resent by other users

---

## Testing Checklist

- [ ] Resend a message and verify only that message GUID is synced to Supabase
- [ ] Check browser console for "Synced only X newly resent messages to Supabase"
- [ ] Verify 2-minute status sync updates rows correctly
- [ ] Check that checkboxes are enabled for all messages (except already resent)
- [ ] Verify "FOD" status shows for messages with attachments
- [ ] Test with Supabase unavailable (should fail gracefully)
- [ ] Verify "Last synced" timestamp updates every 2 minutes
- [ ] Click "Sync Status" button and verify it updates rows immediately
- [ ] Test manual sync with no company code (should show error)
- [ ] Verify manual sync disables checkbox for newly synced resent messages

---

## Code Changes Summary

### Files Modified
- `contentScript.js`

### Functions Modified
1. `showFailedMessages()` - Fixed checkbox disable logic and payload status display
2. `markMessagesAsResent()` - Only sync newly resent messages to Supabase
3. `syncAllLocalToSupabase()` - Only sync resent messages from IndexedDB
4. `statusSyncTimer` - Fixed message GUID matching and error handling

### Lines Changed
- ~200 lines modified across 5 functions
- Added manual sync button with event handler
- No breaking changes
- Backward compatible with existing data

---

## UI Changes

### Messages Screen - New Sync Button

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Overview    FlowFixer - iFlowName (25 messages)      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Select All]  [Resend Selected (0)]              [Sync Status]│
│                                                    ✓ Synced (3) │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ ☑ | Message GUID        | iFlow | Time  | Payload | Status    │
│ ☐ | abc123...           | Flow1 | 10:30 | FOD     | FAILED    │
│ ☐ | def456...           | Flow1 | 10:31 | FOD     | Resent ✓  │ ← Green
└─────────────────────────────────────────────────────────────────┘
```

### Button States
- **Default**: "Sync Status" (dark navy background)
- **Syncing**: "Sync Status" (disabled) + "Syncing..." text
- **Success**: "Sync Status" (enabled) + "✓ Synced (X updated)" in green
- **Error**: "Sync Status" (enabled) + "✗ Sync failed" in red
- **No data**: "Sync Status" (enabled) + "No resent messages found"
