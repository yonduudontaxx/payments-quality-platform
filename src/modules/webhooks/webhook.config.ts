let webhookDeliveryUrl: string | null = null;

export function getWebhookDeliveryUrl(): string | null {
  return webhookDeliveryUrl;
}

export function setWebhookDeliveryUrl(url: string): void {
  webhookDeliveryUrl = url;
}
