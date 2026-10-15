import { logs } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { NodeSDK } from '@opentelemetry/sdk-node'

let posthogLogger

export function initializePostHogLogs() {
  const token = process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN
  const host = process.env.VITE_PUBLIC_POSTHOG_HOST

  if (!token || !host) {
    if (process.env.NODE_ENV === 'development') {
      const variableName = token
        ? 'VITE_PUBLIC_POSTHOG_HOST'
        : 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN'
      throw new Error(
        `${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`,
      )
    }
    return
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'uppercut-mn',
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: new URL('/i/v1/logs', host).toString(),
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      ),
    ],
  })

  sdk.start()
  posthogLogger = logs.getLogger('uppercut-posthog')
}

export function logPostHogInfo(body, attributes) {
  posthogLogger?.emit({
    severityText: 'info',
    body,
    attributes,
  })
}
