import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";

// Module-level client: reused across invocations on a warm Lambda (connection reuse).
const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });

export async function callBedrock(prompt: string): Promise<string> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0";

  const messages: Message[] = [
    {
      role: "user",
      content: [{ text: prompt }],
    },
  ];

  const command = new ConverseCommand({
    modelId,
    messages,
    inferenceConfig: {
      maxTokens: 1024,
      // Low temperature favors consistent, deterministic section formatting over creative variation.
      // Only one of temperature/topP is set — some models (e.g. Claude Haiku, unlike Nova Lite)
      // reject a Converse request that specifies both.
      temperature: 0.3,
    },
  });

  const response = await client.send(command);

  const outputMessage = response.output?.message;
  if (!outputMessage?.content?.[0]?.text) {
    throw new Error("Bedrock returned an empty response");
  }

  return outputMessage.content[0].text.trim();
}
