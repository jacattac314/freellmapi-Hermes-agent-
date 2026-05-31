import { OpenAICompatibleProvider } from './base';

/**
 * Hugging Face Inference API — OpenAI-compatible endpoint.
 * Free tier: ~60 RPH per model via HF Serverless Inference.
 * Docs: https://huggingface.co/docs/api-inference/tasks/chat-completion
 */
export class HuggingFaceProvider extends OpenAICompatibleProvider {
  readonly name = 'huggingface';
  readonly baseUrl = 'https://router.huggingface.co/hf-inference/v1';
  readonly apiKeyEnvVar = 'HF_TOKEN';
}
