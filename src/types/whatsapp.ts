/**
 * WhatsApp Cloud API Type Definitions
 * Based on Meta WhatsApp Cloud API v18.0
 */

/**
 * WhatsApp Webhook Payload Structure
 */
export interface WaWebhookPayload {
  object: string;
  entry: WaWebhookEntry[];
}

export interface WaWebhookEntry {
  id: string;
  changes: WaWebhookChange[];
}

export interface WaWebhookChange {
  value: WaWebhookValue;
  field: string;
}

export interface WaWebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WaContact[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
}

/**
 * WhatsApp Contact Information
 */
export interface WaContact {
  profile: {
    name: string;
  };
  wa_id: string; // Phone number in format 254xxxxxxxxx
}

/**
 * WhatsApp Message
 */
export interface WaMessage {
  from: string; // Phone number
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'button' | 'image' | 'video' | 'audio' | 'document' | 'location';
  text?: {
    body: string;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
  button?: {
    payload: string;
    text: string;
  };
}

/**
 * WhatsApp Status Update
 */
export interface WaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

/**
 * WhatsApp API Response
 */
export interface WaApiResponse {
  messaging_product: string;
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

/**
 * WhatsApp Button
 */
export interface WaButton {
  id: string;
  title: string;
}

/**
 * WhatsApp List Section Row
 */
export interface WaListRow {
  id: string;
  title: string;
  description?: string;
}

/**
 * WhatsApp List Section
 */
export interface WaListSection {
  title: string;
  rows: WaListRow[];
}

/**
 * WhatsApp Service Response
 */
export interface WaServiceResponse {
  messageId: string;
}

