import * as Crypto from 'expo-crypto'

export const LOCAL_INBOX_MESSAGE_ID_PREFIX = 'inbox_'
export const LOCAL_INBOX_NOTIFICATION_IDENTIFIER_PREFIX = 'tb_local_inbox_'

export async function deriveLocalInboxIdentifiers(commandId: string): Promise<Readonly<{
  messageId: string
  notificationId: string
}>> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, commandId)
  const normalizedDigest = digest.toLowerCase()
  return {
    messageId: `${LOCAL_INBOX_MESSAGE_ID_PREFIX}${normalizedDigest}`,
    notificationId: `${LOCAL_INBOX_NOTIFICATION_IDENTIFIER_PREFIX}${normalizedDigest}`,
  }
}
