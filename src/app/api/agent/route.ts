import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { GITHUB_TOOLS, runAgentLoop } from "@/lib/github-tools";

const CANVAS_API =
  process.env.CANVAS_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production"
    ? `http://localhost:${process.env.PORT || 8080}`
    : "http://localhost:1235");

export async function POST(req: NextRequest) {
  try {
    const { documentText, commentText, userName, context, messages: chatMessages, stream: streamRequested } =
      await req.json();

    // Resolve Anthropic API key: user's stored key → env var → error
    let apiKey: string | null = null;
    const cookieHeader = req.headers.get("cookie") || "";

    // 1. Try user's stored credential
    const session = await auth();
    if (session?.user?.email) {
      try {
        const credRes = await fetch(
          `${CANVAS_API}/api/canvas/credentials/anthropic/key`,
          { headers: { Cookie: cookieHeader } }
        );
        if (credRes.ok) {
          const { apiKey: userKey } = await credRes.json();
          if (userKey) apiKey = userKey;
        }
      } catch {
        // Fall through to env var
      }
    }

    // 2. Fallback to environment variable
    if (!apiKey && process.env.ANTHROPIC_API_KEY) {
      apiKey = process.env.ANTHROPIC_API_KEY;
    }

    // 3. No key available
    if (!apiKey) {
      return NextResponse.json(
        { error: "No Anthropic API key configured. Add one in Settings > Integrations." },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({ apiKey });

    // Fetch user's connected repos for AI context
    let repoList: { repo_full_name: string; description: string | null }[] = [];
    try {
      const reposRes = await fetch(
        `${CANVAS_API}/api/canvas/github/user-repos`,
        { headers: { Cookie: cookieHeader } }
      );
      if (reposRes.ok) {
        const data = await reposRes.json();
        repoList = data.repos || [];
      }
    } catch {
      // No repos available — that's fine
    }

    const hasRepos = repoList.length > 0;
    const repoContextNote = hasRepos
      ? `\n\nYou have access to these GitHub repositories via tools:\n${repoList.map((r) => `- ${r.repo_full_name}${r.description ? ` — ${r.description}` : ""}`).join("\n")}\n\nUse the list_directory, read_file, and search_code tools to explore them when relevant to the user's question.`
      : "";

    let systemPrompt: string;
    let userMessage: string;

    if (context === "chat") {
      systemPrompt = `You are Claude, an AI assistant in a collaborative document editor called Canvas. You are in a chat conversation with the user. Be helpful, concise, and conversational. You have full context of the conversation history. You can discuss the document, suggest edits, answer questions, or help with writing tasks.${repoContextNote}`;
      // userMessage is not used directly for chat — we use chatMessages instead
      userMessage = "";
    } else if (context === "comment") {
      systemPrompt = `You are Claude, an AI assistant participating in a collaborative document editing session on Canvas. A user has tagged you in a comment thread. Be helpful, concise, and collaborative. You can suggest edits, answer questions, or provide feedback on the document.${repoContextNote}`;
      userMessage = `User "${userName}" tagged you in a comment: "${commentText}"`;
    } else {
      systemPrompt = `You are Claude, an AI assistant participating in a collaborative document editing session on Canvas. A user has mentioned you in the document using @claude. Read the document context and provide a helpful, concise response. You can suggest improvements, answer questions embedded in the text, continue writing, or help with whatever the user seems to need based on the document content.${repoContextNote}`;
      userMessage = `User "${userName}" mentioned you in this document:\n\n${documentText}\n\nProvide a helpful response based on the document content. Be concise.`;
    }

    // Build multi-turn messages for chat context
    const initialMessages: Anthropic.MessageParam[] | undefined =
      context === "chat" && chatMessages
        ? (chatMessages as Anthropic.MessageParam[]).slice(-20)
        : undefined;

    // Use agentic loop if repos are connected, otherwise simple call
    if (hasRepos) {
      // SSE streaming path
      if (streamRequested) {
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              const result = await runAgentLoop({
                anthropic,
                systemPrompt,
                userMessage,
                tools: GITHUB_TOOLS,
                cookieHeader,
                initialMessages,
                onProgress(event) {
                  controller.enqueue(
                    encoder.encode(`event: progress\ndata: ${JSON.stringify(event)}\n\n`)
                  );
                },
              });

              controller.enqueue(
                encoder.encode(`event: result\ndata: ${JSON.stringify({ response: result.text })}\n\n`)
              );
            } catch (err) {
              controller.enqueue(
                encoder.encode(`event: result\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // Non-streaming agentic path
      const result = await runAgentLoop({
        anthropic,
        systemPrompt,
        userMessage,
        tools: GITHUB_TOOLS,
        cookieHeader,
        initialMessages,
      });
      return NextResponse.json({ response: result.text });
    }

    // No repos — simple single-turn call (no tools needed)
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: initialMessages || [{ role: "user", content: userMessage }],
    });

    const response = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return NextResponse.json({ response });
  } catch (error) {
    console.error("Agent error:", error);
    return NextResponse.json(
      { error: "Agent request failed" },
      { status: 500 }
    );
  }
}
