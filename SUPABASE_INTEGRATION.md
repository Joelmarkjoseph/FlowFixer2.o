# Supabase Integration for FlowFixer

## Overview
Multi-user shift handover with real-time status sync using Supabase.

## Database Schema

### Table: `resent_messages`

```sql
CREATE TABLE resent_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_code TEXT NOT NULL,
  message_guid TEXT NOT NULL,
  iflow_name TEXT,
  status TEXT DEFAULT 'Resent',
  resent_at TIMESTAMP,
  resent_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_company_message UNIQUE(company_code, message_guid)
);

-- Index for faster queries
CREATE INDEX idx_company_code ON resent_messages(company_code);
CREATE INDEX idx_message_guid ON resent_messages(message_guid);
CREATE INDEX idx_status ON resent_messages(status);

-- Row Level Security (RLS)
ALTER TABLE resent_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations (since we're using anon key)
CREATE POLICY "Allow all operations" ON resent_messages
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

## Setup Instructions

### 1. Create Table in Supabase
1. Go to https://igntzaubcfftkcqeeihw.supabase.co
2. Navigate to SQL Editor
3. Run the SQL schema above
4. Verify table is created

### 2. Configure Extension
- Supabase URL and key are hardcoded in `supabaseHelper.js`
- Users enter Company Code during authentication

### 3. Company Code
- Each company/team gets a unique code (e.g., "ACME", "CORP01")
- Used to isolate data between companies
- Entered once during auth, saved locally

## How It Works

### Authentication Flow
1. User clicks "Resender" button
2. Auth dialog appears with fields:
   - **Company Code** (new field)
   - Username
   - Password
   - API URL (CF only)
   - Client ID/Secret (CF only)
3. Company Code is saved to chrome.storage.local
4. Used for all Supabase operations

### Sync Flow

**On Successful Resend:**
```javascript
// 1. Mark message as resent locally
await flowFixerDB.addToResentHistory(messageGuid, iflowName);

// 2. Sync to Supabase
await supabaseHelper.upsertResentMessage({
  companyCode: savedCompanyCode,
  messageGuid: messageGuid,
  iflowName: iflowName,
  status: 'Resent',
  resentAt: new Date().toISOString(),
  resentBy: username
});
```

**On Auto-Refresh (Every 5 min):**
```javascript
// 1. Fetch fresh messages from SAP CPI
const freshData = await fetchMessageProcessingLogs(...);

// 2. Fetch resent statuses from Supabase
const resentGuids = await supabaseHelper.getResentMessageGuids(companyCode);

// 3. Mark messages as green if in Supabase
messages.forEach(msg => {
  if (resentGuids.includes(msg.MessageGuid)) {
    msg.resentSuccessfully = true;
  }
});
```

**On Manual Fetch:**
- Same as auto-refresh
- Fetches latest from both SAP CPI and Supabase

## Data Flow

```
User A (Shift 1)                    Supabase                    User B (Shift 2)
     |                                  |                              |
     | 1. Resend MS1                    |                              |
     |--------------------------------->|                              |
     |    (MS1 = Resent)                |                              |
     |                                  |                              |
     |                                  | 2. Auto-refresh (5 min)      |
     |                                  |<-----------------------------|
     |                                  |    Fetch resent messages     |
     |                                  |----------------------------->|
     |                                  |    (MS1 = Resent)            |
     |                                  |                              |
     |                                  |                         3. MS1 shows green
```

## Benefits

✅ **Real-time sync** - Status updates visible to all users
✅ **Multi-user support** - Multiple operators can work simultaneously
✅ **Shift handover** - No need to export/import files
✅ **Company isolation** - Each company's data is separate
✅ **Offline fallback** - Local IndexedDB still works
✅ **No payload storage** - Only metadata synced (secure)

## API Usage

### Upsert Single Message
```javascript
await supabaseHelper.upsertResentMessage({
  companyCode: 'ACME',
  messageGuid: 'ABC-123-456',
  iflowName: 'OrderProcessing',
  status: 'Resent',
  resentAt: '2025-11-20T10:30:00Z',
  resentBy: 'user@company.com'
});
```

### Upsert Multiple Messages
```javascript
await supabaseHelper.upsertMultipleResentMessages([
  { companyCode: 'ACME', messageGuid: 'MS1', ... },
  { companyCode: 'ACME', messageGuid: 'MS2', ... }
]);
```

### Get Resent Messages
```javascript
const messages = await supabaseHelper.getResentMessages('ACME');
// Returns: [{ message_guid: 'MS1', status: 'Resent', ... }]
```

### Get Message GUIDs Only
```javascript
const guids = await supabaseHelper.getResentMessageGuids('ACME');
// Returns: ['MS1', 'MS2', 'MS3']
```

## Error Handling

- Network errors → Falls back to local IndexedDB
- Supabase down → Extension still works offline
- Sync failures → Logged to console, doesn't block UI

## Security

- ✅ Anon key used (read/write access)
- ✅ No sensitive data stored (no payloads)
- ✅ Company code isolates data
- ✅ RLS enabled (can be enhanced later)
- ⚠️ Consider service_role key for production (more secure)

## Testing

1. **Single User:**
   - Resend message → Check Supabase table
   - Refresh → Message stays green

2. **Multi User:**
   - User A resends MS1
   - User B refreshes → MS1 shows green

3. **Offline:**
   - Disconnect internet
   - Extension still works with local data
   - Reconnect → Syncs to Supabase

## Future Enhancements

- Add user authentication (not just company code)
- Track who resent each message
- Add audit log
- Add message notes/comments
- Real-time updates (WebSocket)
