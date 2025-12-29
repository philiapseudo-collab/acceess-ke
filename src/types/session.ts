/**
 * BotState represents the current state of the user's conversation flow
 */
export enum BotState {
  IDLE = 'IDLE',
  BROWSING_EVENTS = 'BROWSING_EVENTS',
  SELECTING_TIER = 'SELECTING_TIER',
  SELECTING_QUANTITY = 'SELECTING_QUANTITY',
  CONFIRMING_ORDER = 'CONFIRMING_ORDER',
  AWAITING_PAYMENT_METHOD = 'AWAITING_PAYMENT_METHOD',
  AWAITING_PAYMENT_PHONE = 'AWAITING_PAYMENT_PHONE',
  AWAITING_STK_PUSH = 'AWAITING_STK_PUSH',
}

/**
 * SessionData stores temporary user choices during the booking flow
 */
export interface SessionData {
  eventId?: string;
  tierId?: string;
  quantity?: number;
  totalAmount?: number;
  paymentMethod?: 'MPESA' | 'CARD';
  tempBookingId?: string;
}

/**
 * Session represents the complete session state stored in Redis
 */
export interface Session {
  state: BotState;
  data: SessionData;
}

