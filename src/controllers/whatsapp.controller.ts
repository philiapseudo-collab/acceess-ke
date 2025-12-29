import { Request, Response } from 'express';
import logger from '../config/logger';
import { AppError } from '../utils/AppError';
import whatsappService from '../services/whatsapp.service';
import conversationHandler from '../handlers/conversation.handler';
import {
  WaWebhookPayload,
  WaMessage,
  WaContact,
} from '../types/whatsapp';

/**
 * WhatsAppController handles webhook verification and incoming messages
 */
class WhatsAppController {
  /**
   * Verifies the webhook with Meta
   * GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
   * @param req - Express request
   * @param res - Express response
   */
  async verifyWebhook(req: Request, res: Response): Promise<void> {
    try {
      const mode = req.query['hub.mode'] as string;
      const verifyToken = req.query['hub.verify_token'] as string;
      const challenge = req.query['hub.challenge'] as string;

      logger.info('Webhook verification attempt:', {
        mode,
        verifyToken: verifyToken ? '***' : 'missing',
        challenge: challenge ? 'present' : 'missing',
      });

      // Meta requires: mode === 'subscribe' AND verify_token matches
      if (mode === 'subscribe' && verifyToken === process.env.WA_VERIFY_TOKEN) {
        logger.info('Webhook verification: Success');
        // Return challenge as plain text
        res.status(200).send(challenge);
      } else {
        logger.warn('Webhook verification: Failed - Invalid token or mode');
        res.status(403).send('Forbidden');
      }
    } catch (error) {
      logger.error('Webhook verification error:', error);
      res.status(500).send('Internal error');
    }
  }

  /**
   * Receives incoming webhooks from Meta
   * POST /webhook
   * @param req - Express request
   * @param res - Express response
   */
  async receiveWebhook(req: Request, res: Response): Promise<void> {
    try {
      // Always return 200 OK immediately (Meta requirement)
      res.status(200).send('OK');

      // Parse the webhook payload
      const payload: WaWebhookPayload = req.body;

      // Log entire payload for debugging
      logger.debug('WhatsApp webhook received:', JSON.stringify(payload, null, 2));

      // Validate payload structure
      if (!payload.entry || !Array.isArray(payload.entry) || payload.entry.length === 0) {
        logger.warn('WhatsApp webhook: Invalid payload structure (no entries)');
        return;
      }

      // Process each entry
      for (const entry of payload.entry) {
        if (!entry.changes || !Array.isArray(entry.changes) || entry.changes.length === 0) {
          continue;
        }

        for (const change of entry.changes) {
          const value = change.value;

          // Handle status updates (sent, delivered, read) - ignore for now
          if (value.statuses && value.statuses.length > 0) {
            logger.debug('WhatsApp status update received:', value.statuses);
            continue;
          }

          // Handle messages
          if (value.messages && Array.isArray(value.messages) && value.messages.length > 0) {
            // Extract message and contact info
            const message: WaMessage = value.messages[0];
            const contact: WaContact | undefined = value.contacts?.[0];

            // Mark message as read (vital for UX)
            if (message.id) {
              await whatsappService.markAsRead(message.id).catch((error) => {
                logger.error('Failed to mark message as read:', error);
                // Continue processing even if mark as read fails
              });
            }

            // Log incoming message
            logger.info('WhatsApp message received:', {
              messageId: message.id,
              from: message.from,
              type: message.type,
              timestamp: message.timestamp,
              contactName: contact?.profile?.name,
              contactWaId: contact?.wa_id,
            });

            // Extract message text based on type
            let messageText: string | undefined;

            if (message.type === 'text' && message.text) {
              messageText = message.text.body;
            } else if (message.type === 'interactive' && message.interactive) {
              if (message.interactive.type === 'button_reply' && message.interactive.button_reply) {
                messageText = message.interactive.button_reply.id;
              } else if (
                message.interactive.type === 'list_reply' &&
                message.interactive.list_reply
              ) {
                messageText = message.interactive.list_reply.id;
              }
            } else if (message.type === 'button' && message.button) {
              messageText = message.button.payload || message.button.text;
            }

            if (messageText) {
              logger.info(`Message content: ${messageText}`);
            }

            // Extract message type and body for ConversationHandler
            const messageType: 'text' | 'interactive' = message.type === 'text' ? 'text' : 'interactive';
            
            // For interactive messages, use the ID as the body
            let messageBody = messageText || '';
            let messageId: string | undefined;

            if (message.type === 'interactive' && message.interactive) {
              if (message.interactive.type === 'button_reply' && message.interactive.button_reply) {
                messageId = message.interactive.button_reply.id;
                messageBody = message.interactive.button_reply.id; // Use ID as body
              } else if (
                message.interactive.type === 'list_reply' &&
                message.interactive.list_reply
              ) {
                messageId = message.interactive.list_reply.id;
                messageBody = message.interactive.list_reply.id; // Use ID as body
              }
            }

            // Pass to ConversationHandler
            await conversationHandler.handleMessage(
              {
                phone: message.from,
                name: contact?.profile?.name,
              },
              {
                type: messageType,
                body: messageBody,
                id: messageId,
              }
            );
          } else {
            // Empty messages array - Meta sends status updates here
            logger.debug('WhatsApp webhook: Empty messages array (status update)');
          }
        }
      }
    } catch (error) {
      logger.error('WhatsApp webhook processing error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        body: req.body,
      });
      // Don't send response - already sent 200 OK
    }
  }
}

// Export singleton instance
export default new WhatsAppController();

