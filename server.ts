import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
let openai: OpenAI | null = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
let anthropic: Anthropic | null = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY environment variable is required");
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post("/api/create-payment-intent", async (req, res) => {
    try {
      const stripe = getStripe();
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 599, // $5.99
        currency: 'usd',
      });
      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
      console.error("Stripe Error:", error);
      res.status(500).json({ error: error.message || "Failed to create payment intent" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, model } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages are required" });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const lastMessage = messages[messages.length - 1].content.toLowerCase();
      let selectedModel = 'gemini-3.5-flash';

      if (model && model !== 'auto') {
        selectedModel = model;
      } else {
        if ((lastMessage.includes('code') || lastMessage.includes('react') || lastMessage.includes('html')) && anthropic) {
          selectedModel = 'claude-3-5-sonnet-20241022';
        } else if ((lastMessage.includes('creative') || lastMessage.includes('story') || lastMessage.includes('essay')) && openai) {
          selectedModel = 'gpt-4o';
        } else if (lastMessage.includes('complex') || lastMessage.includes('math')) {
          selectedModel = 'gemini-3.1-pro-preview';
        }
      }

      const prefixName = selectedModel.includes('claude') ? 'CLAUDE' : selectedModel.includes('gpt') ? 'GPT' : 'GEMINI';
      const prefix = `[Answered by ${prefixName} (${selectedModel})]\n\n`;
      res.write(`data: ${JSON.stringify({ text: prefix })}\n\n`);

      const systemPrompt = `You are Titan AI, an elite, hyper-intelligent AI assistant combining the strengths of Gemini, GPT, and Claude. You possess deep expertise in software engineering, mathematics, creative writing, science, and world history. Always provide highly accurate, insightful, and beautifully formatted responses. Be concise when appropriate, but exhaustively detailed when the user asks complex questions. You are friendly, empathetic, and exceptionally capable.`;

      if (selectedModel.startsWith('claude') && anthropic) {
        const stream = await anthropic.messages.create({
          model: selectedModel,
          max_tokens: 1024,
          system: systemPrompt,
          stream: true,
          messages: messages.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
        });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
          }
        }
      } else if (selectedModel.startsWith('gpt') && openai) {
        const gptMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
        ] as any[];
        const stream = await openai.chat.completions.create({
          model: selectedModel,
          stream: true,
          messages: gptMessages
        });
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
          }
        }
      } else {
        const contents = messages.map((m: any) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }));

        const responseStream = await ai.models.generateContentStream({
          model: selectedModel,
          contents,
          config: {
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }]
          }
        });
        for await (const chunk of responseStream) {
          if (chunk.text) {
             res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
          }
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      console.error("AI Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Failed to generate response" });
      } else {
        res.write(`data: ${JSON.stringify({ text: "\n\n[Error: " + error.message + "]" })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
