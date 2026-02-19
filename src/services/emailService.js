import env from '../config/env.js'
import logger from '../config/logger.js'

class EmailService {
  async sendInvitationEmail({ to, name, authLink, expiresAt }) {
    if (!env.emailTransportEnabled) {
      logger.info(
        {
          to,
          expiresAt,
          mock: true,
        },
        'Invitation email send (mock mode)',
      )
      return { messageId: `mock-${Date.now()}` }
    }

    throw new Error(
      'Email transport not configured - set EMAIL_TRANSPORT_ENABLED=true and configure EMAIL_TRANSPORT_* vars',
    )
  }
}

export default new EmailService()
