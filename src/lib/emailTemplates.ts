import {
  CustomDomain,
  TempInbox,
  MailMessage,
  WebhookEndpoint,
  WebhookDeliveryLog,
  ApiKeyRecord,
} from './mailEngine';

export function createInitialSeedState(): {
  domains: CustomDomain[];
  inboxes: TempInbox[];
  messages: MailMessage[];
  webhooks: WebhookEndpoint[];
  deliveries: WebhookDeliveryLog[];
  apiKeys: ApiKeyRecord[];
} {
  return {
    domains: [],
    inboxes: [],
    messages: [],
    webhooks: [],
    deliveries: [],
    apiKeys: [],
  };
}
