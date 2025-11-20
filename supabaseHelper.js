/* Supabase Helper for FlowFixer */

const SUPABASE_URL = 'https://igntzaubcfftkcqeeihw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbnR6YXViY2ZmdGtjcWVlaWh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MTIxNTUsImV4cCI6MjA3OTE4ODE1NX0.SLNfvBOfIW2HKb422RW7b7BwgdeqeEKe3YV467ThAAw';

class SupabaseHelper {
  constructor() {
    this.url = SUPABASE_URL;
    this.key = SUPABASE_ANON_KEY;
  }

  /**
   * Make a request to Supabase REST API
   */
  async request(method, endpoint, body = null) {
    const url = `${this.url}/rest/v1/${endpoint}`;
    
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    const options = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Supabase error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Supabase request failed:', error);
      throw error;
    }
  }

  /**
   * Upsert a resent message (insert or update)
   * @param {Object} messageData - Message data to upsert
   */
  async upsertResentMessage(messageData) {
    const {
      companyCode,
      messageGuid,
      iflowName,
      status,
      resentAt,
      resentBy
    } = messageData;

    const record = {
      company_code: companyCode,
      message_guid: messageGuid,
      iflow_name: iflowName,
      status: status,
      resent_at: resentAt,
      resent_by: resentBy,
      updated_at: new Date().toISOString()
    };

    try {
      const result = await this.request('POST', 'resent_messages', record);
      console.log('✓ Synced to Supabase:', messageGuid);
      return result;
    } catch (error) {
      console.error('Failed to sync to Supabase:', error);
      throw error;
    }
  }

  /**
   * Upsert multiple resent messages
   */
  async upsertMultipleResentMessages(messages) {
    const records = messages.map(msg => ({
      company_code: msg.companyCode,
      message_guid: msg.messageGuid,
      iflow_name: msg.iflowName,
      status: msg.status,
      resent_at: msg.resentAt,
      resent_by: msg.resentBy,
      updated_at: new Date().toISOString()
    }));

    try {
      const result = await this.request('POST', 'resent_messages', records);
      console.log(`✓ Synced ${records.length} messages to Supabase`);
      return result;
    } catch (error) {
      console.error('Failed to sync multiple messages to Supabase:', error);
      throw error;
    }
  }

  /**
   * Get all resent messages for a company
   */
  async getResentMessages(companyCode) {
    try {
      const endpoint = `resent_messages?company_code=eq.${companyCode}&select=*`;
      const result = await this.request('GET', endpoint);
      console.log(`✓ Fetched ${result.length} resent messages from Supabase for company: ${companyCode}`);
      return result;
    } catch (error) {
      console.error('Failed to fetch from Supabase:', error);
      return [];
    }
  }

  /**
   * Get resent message GUIDs for a company (for quick lookup)
   */
  async getResentMessageGuids(companyCode) {
    try {
      const messages = await this.getResentMessages(companyCode);
      return messages.map(msg => msg.message_guid);
    } catch (error) {
      console.error('Failed to fetch message GUIDs from Supabase:', error);
      return [];
    }
  }

  /**
   * Delete a resent message
   */
  async deleteResentMessage(companyCode, messageGuid) {
    try {
      const endpoint = `resent_messages?company_code=eq.${companyCode}&message_guid=eq.${messageGuid}`;
      await this.request('DELETE', endpoint);
      console.log('✓ Deleted from Supabase:', messageGuid);
    } catch (error) {
      console.error('Failed to delete from Supabase:', error);
      throw error;
    }
  }

  /**
   * Clear all resent messages for a company
   */
  async clearResentMessages(companyCode) {
    try {
      const endpoint = `resent_messages?company_code=eq.${companyCode}`;
      await this.request('DELETE', endpoint);
      console.log('✓ Cleared all resent messages from Supabase for company:', companyCode);
    } catch (error) {
      console.error('Failed to clear Supabase data:', error);
      throw error;
    }
  }

  /**
   * Sync local IndexedDB data to Supabase
   */
  async syncLocalToSupabase(companyCode, localMessages) {
    try {
      const messages = localMessages.map(msg => ({
        companyCode: companyCode,
        messageGuid: msg.messageGuid,
        iflowName: msg.iFlowName,
        status: 'Resent',
        resentAt: msg.resentAt,
        resentBy: companyCode // or username if available
      }));

      if (messages.length > 0) {
        await this.upsertMultipleResentMessages(messages);
        console.log(`✓ Synced ${messages.length} local messages to Supabase`);
      }
    } catch (error) {
      console.error('Failed to sync local to Supabase:', error);
    }
  }
}

// Create global instance
const supabaseHelper = new SupabaseHelper();
