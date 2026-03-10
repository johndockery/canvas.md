import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { GITHUB_TOOLS, runAgentLoop } from "@/lib/github-tools";

const CANVAS_API =
  process.env.CANVAS_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production"
    ? `http://localhost:${process.env.PORT || 8080}`
    : "http://localhost:1235");

const APPLY_EDITS_TOOL: Anthropic.Tool = {
  name: "apply_edits",
  description:
    "Apply structured edits to the document. Each edit specifies an exact original_text to find and its replacement new_text.",
  input_schema: {
    type: "object" as const,
    properties: {
      message: {
        type: "string" as const,
        description:
          "Summary message like 'Done. Made 3 edits:' — keep it brief.",
      },
      edits: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            title: {
              type: "string" as const,
              description:
                "Short label for the edit, e.g. 'Rewrote item 1'",
            },
            description: {
              type: "string" as const,
              description:
                "One-line explanation of what changed, e.g. 'Added deadline, clarified scope freeze'",
            },
            original_text: {
              type: "string" as const,
              description:
                "Exact text to find in the document. Must be a verbatim substring of the current document.",
            },
            new_text: {
              type: "string" as const,
              description: "Replacement text that will take its place.",
            },
          },
          required: [
            "title",
            "description",
            "original_text",
            "new_text",
          ],
        },
      },
    },
    required: ["message", "edits"],
  },
};

export async function POST(req: NextRequest) {
  try {
    const { instruction, documentText, context, userName, messages: chatMessages, stream: streamRequested } =
      await req.json();

    if (!instruction) {
      return NextResponse.json(
        { error: "Missing required field: instruction" },
        { status: 400 }
      );
    }

    // Resolve Anthropic API key: user's stored key -> env var -> error
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
        {
          error:
            "No Anthropic API key configured. Add one in Settings > Integrations.",
        },
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
      // No repos available
    }

    const hasRepos = repoList.length > 0;

    const systemPrompt = `You are Claude, an AI writing assistant in a collaborative document editor called Canvas. The user is chatting with you in a sidebar next to their document.

## Your #1 Job: Write to the Document
Your primary job is to write content into the document by calling the apply_edits tool. You MUST call apply_edits whenever the user asks you to create, write, draft, edit, or update document content.

CRITICAL RULES:
- NEVER put document content in a chat response. Always use apply_edits.
- NEVER describe what you would write. ACTUALLY write it.
- After exploring repos/gathering information, you MUST compile findings into the document via apply_edits. Do not just summarize in chat.
- The only exception: if the user asks a pure question ("what does this repo do?", "explain this concept"), respond with text.

## Empty Document (MOST IMPORTANT)
If the document is empty, you MUST use original_text: "" (exactly an empty string) and put ALL content in new_text. This is the single most common failure — get it right.

## apply_edits Rules
- original_text: EXACT verbatim substring of the current document (whitespace-sensitive)
- new_text: the replacement content
- message: brief summary like "Done. Made 3 edits:"
- Each edit needs a title and description
- To APPEND: use the last paragraph as original_text, set new_text to that paragraph + new content
- To REPLACE ALL: use a large section as original_text, set new_text to the full new content
- Write thorough, well-structured content using markdown (headers, lists, bold, code blocks)
${hasRepos ? `
## GitHub Exploration Strategy
You have access to these repositories:
${repoList.map((r) => `- ${r.repo_full_name}${r.description ? ` — ${r.description}` : ""}`).join("\n")}

Use list_directory, read_file, and search_code to explore them. But be STRATEGIC:
1. Plan what you need to find before exploring
2. Be efficient — typically 3-8 file reads is enough. Don't read every file.
3. After gathering enough context, STOP exploring and call apply_edits immediately
4. Do NOT keep exploring indefinitely. Get the key information, then write.
5. You can always note areas for further investigation in the document itself.` : ""}`;

    const docSection = documentText && documentText !== "(empty document)"
      ? `Here is the current document text:\n\n---\n${documentText}\n---`
      : "The document is currently empty.";

    const userMessage = `${docSection}

User "${userName || "Anonymous"}" instruction: ${instruction}${context ? `\n\nAdditional context: ${context}` : ""}`;

    // Build multi-turn messages for chat context
    const initialMessages: Anthropic.MessageParam[] | undefined =
      chatMessages
        ? (chatMessages as Anthropic.MessageParam[]).slice(-20)
        : undefined;

    console.log("[agent-edit] hasRepos:", hasRepos, "streamRequested:", streamRequested, "docText length:", (documentText || "").length);

    // Use agentic loop if repos are connected so Claude can explore first
    if (hasRepos) {
      const allTools = [...GITHUB_TOOLS, APPLY_EDITS_TOOL];

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
                tools: allTools,
                cookieHeader,
                terminalTools: ["apply_edits"],
                initialMessages,
                signal: req.signal,
                onProgress(event) {
                  controller.enqueue(
                    encoder.encode(`event: progress\ndata: ${JSON.stringify(event)}\n\n`)
                  );
                },
                onEditStream(data) {
                  controller.enqueue(
                    encoder.encode(`event: edit_delta\ndata: ${JSON.stringify(data)}\n\n`)
                  );
                },
              });

              // Helper: make a direct forced apply_edits call as last resort
              async function forcedApplyEdits(context: string): Promise<{ message: string; edits: Array<{ id: string; title: string; description: string; originalText: string; newText: string }> } | null> {
                try {
                  const directResponse = await anthropic.messages.create({
                    model: "claude-sonnet-4-20250514",
                    max_tokens: 16384,
                    system: systemPrompt,
                    tools: [APPLY_EDITS_TOOL],
                    tool_choice: { type: "tool", name: "apply_edits" },
                    messages: [
                      {
                        role: "user",
                        content: `${userMessage}\n\n---\n\nAfter exploring, here is what was found:\n\n${context}\n\nWrite this into the document now via apply_edits. Use original_text: "" if the document is empty. The edits array MUST contain at least one edit. Put thorough, well-structured markdown content in new_text. Do NOT leave edits empty.`,
                      },
                    ],
                  });
                  const toolBlock = directResponse.content.find(
                    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
                  );
                  if (toolBlock) {
                    const inp = toolBlock.input as {
                      message: string;
                      edits: Array<{ title: string; description: string; original_text: string; new_text: string }>;
                    };
                    const edits = (inp.edits || []).filter(e => e.new_text).map((edit, i) => ({
                      id: `edit-${Date.now()}-${i}`,
                      title: edit.title,
                      description: edit.description,
                      originalText: edit.original_text,
                      newText: edit.new_text,
                    }));
                    if (edits.length > 0) return { message: inp.message, edits };
                  }
                } catch (err) {
                  console.error("[agent-edit] Forced apply_edits error:", err);
                }
                return null;
              }

              let payload: { message: string; edits: unknown[] };
              if (result.toolCall && result.toolCall.name === "apply_edits") {
                const inp = result.toolCall.input as {
                  message: string;
                  edits: Array<{
                    title: string;
                    description: string;
                    original_text: string;
                    new_text: string;
                  }>;
                };
                const edits = (inp.edits || []).filter(e => e.new_text).map((edit, i) => ({
                  id: `edit-${Date.now()}-${i}`,
                  title: edit.title,
                  description: edit.description,
                  originalText: edit.original_text,
                  newText: edit.new_text,
                }));
                if (edits.length > 0) {
                  console.log("[agent-edit] SSE: apply_edits with", edits.length, "edits, first newText length:", edits[0].newText.length);
                  payload = { message: inp.message, edits };
                } else {
                  // Agent called apply_edits but with empty edits — retry
                  console.warn("[agent-edit] SSE: apply_edits had empty edits. Retrying with forced call...");
                  const retry = await forcedApplyEdits(inp.message || result.text);
                  payload = retry || { message: inp.message || result.text, edits: [] };
                }
              } else {
                // Agent didn't call apply_edits at all — retry
                console.warn("[agent-edit] SSE: No apply_edits tool call. Retrying with forced call...");
                const retry = await forcedApplyEdits(result.text);
                payload = retry || { message: result.text, edits: [] };
              }

              controller.enqueue(
                encoder.encode(`event: result\ndata: ${JSON.stringify(payload)}\n\n`)
              );
            } catch (err) {
              console.error("[agent-edit] SSE error:", err);
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
        tools: allTools,
        cookieHeader,
        terminalTools: ["apply_edits"],
        initialMessages,
        signal: req.signal,
      });

      if (result.toolCall && result.toolCall.name === "apply_edits") {
        const input = result.toolCall.input as {
          message: string;
          edits: Array<{
            title: string;
            description: string;
            original_text: string;
            new_text: string;
          }>;
        };
        const edits = (input.edits || []).filter(e => e.new_text).map((edit, i) => ({
          id: `edit-${Date.now()}-${i}`,
          title: edit.title,
          description: edit.description,
          originalText: edit.original_text,
          newText: edit.new_text,
        }));
        if (edits.length > 0) {
          console.log("[agent-edit] Non-stream: apply_edits with", edits.length, "edits");
          return NextResponse.json({ message: input.message, edits });
        }
        // apply_edits called with empty edits — fall through to retry
        console.warn("[agent-edit] Non-stream: apply_edits had empty edits, retrying...");
      }

      // No usable edits — make a direct forced call
      console.warn("[agent-edit] Non-stream: Attempting direct forced call...");
      try {
        const directResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16384,
          system: systemPrompt,
          tools: [APPLY_EDITS_TOOL],
          tool_choice: { type: "tool", name: "apply_edits" },
          messages: [
            {
              role: "user",
              content: `${userMessage}\n\n---\n\nAfter exploring, here is what was found:\n\n${result.text || (result.toolCall?.input as Record<string, unknown>)?.message || ""}\n\nWrite this into the document now via apply_edits. Use original_text: "" if the document is empty. The edits array MUST contain at least one edit. Put thorough, well-structured markdown content in new_text. Do NOT leave edits empty.`,
            },
          ],
        });
        const directToolBlock = directResponse.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );
        if (directToolBlock) {
          const inp = directToolBlock.input as {
            message: string;
            edits: Array<{ title: string; description: string; original_text: string; new_text: string }>;
          };
          const edits = (inp.edits || []).filter(e => e.new_text).map((edit, i) => ({
            id: `edit-${Date.now()}-${i}`,
            title: edit.title,
            description: edit.description,
            originalText: edit.original_text,
            newText: edit.new_text,
          }));
          if (edits.length > 0) {
            console.log("[agent-edit] Non-stream: Direct forced call produced", edits.length, "edits");
            return NextResponse.json({ message: inp.message, edits });
          }
        }
      } catch (directErr) {
        console.error("[agent-edit] Non-stream: Direct forced call error:", directErr);
      }
      return NextResponse.json({ message: result.text || "Failed to generate document content.", edits: [] });
    }

    // No repos — single-turn forced tool call
    console.log("[agent-edit] No repos path — forced tool call, stream:", streamRequested);

    if (streamRequested) {
      // SSE streaming path for no-repo case
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            const stream = anthropic.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 8192,
              system: systemPrompt,
              tools: [APPLY_EDITS_TOOL],
              tool_choice: { type: "tool", name: "apply_edits" },
              messages: initialMessages || [{ role: "user", content: userMessage }],
            });

            const sentLengths: number[] = [];
            stream.on("inputJson", (_partial: string, snapshot: unknown) => {
              const snap = snapshot as { edits?: Array<{ original_text?: string; new_text?: string }> };
              if (!snap.edits) return;
              for (let i = 0; i < snap.edits.length; i++) {
                const edit = snap.edits[i];
                if (!edit?.new_text) continue;
                const prev = sentLengths[i] || 0;
                if (edit.new_text.length > prev) {
                  controller.enqueue(encoder.encode(
                    `event: edit_delta\ndata: ${JSON.stringify({
                      editIndex: i,
                      originalText: edit.original_text ?? "",
                      delta: edit.new_text.slice(prev),
                    })}\n\n`
                  ));
                  sentLengths[i] = edit.new_text.length;
                }
              }
            });

            const finalMessage = await stream.finalMessage();

            const toolUseBlock = finalMessage.content.find(
              (block) => block.type === "tool_use"
            );

            if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
              controller.enqueue(encoder.encode(
                `event: result\ndata: ${JSON.stringify({ error: "Claude did not return structured edits." })}\n\n`
              ));
            } else {
              const inp = toolUseBlock.input as {
                message: string;
                edits: Array<{
                  title: string;
                  description: string;
                  original_text: string;
                  new_text: string;
                }>;
              };
              const edits = (inp.edits || []).map((edit, i) => ({
                id: `edit-${Date.now()}-${i}`,
                title: edit.title,
                description: edit.description,
                originalText: edit.original_text,
                newText: edit.new_text,
              }));
              console.log("[agent-edit] No-repo SSE: apply_edits with", edits.length, "edits");
              controller.enqueue(encoder.encode(
                `event: result\ndata: ${JSON.stringify({ message: inp.message, edits })}\n\n`
              ));
            }
          } catch (err) {
            console.error("[agent-edit] No-repo SSE error:", err);
            controller.enqueue(encoder.encode(
              `event: result\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`
            ));
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

    // Non-streaming fallback (original behavior)
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools: [APPLY_EDITS_TOOL],
      tool_choice: { type: "tool", name: "apply_edits" },
      messages: initialMessages || [{ role: "user", content: userMessage }],
    });

    const toolUseBlock = message.content.find(
      (block) => block.type === "tool_use"
    );

    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return NextResponse.json(
        { error: "Claude did not return structured edits." },
        { status: 500 }
      );
    }

    const input = toolUseBlock.input as {
      message: string;
      edits: Array<{
        title: string;
        description: string;
        original_text: string;
        new_text: string;
      }>;
    };

    const edits = input.edits.map((edit, i) => ({
      id: `edit-${Date.now()}-${i}`,
      title: edit.title,
      description: edit.description,
      originalText: edit.original_text,
      newText: edit.new_text,
    }));

    console.log("[agent-edit] Forced tool call: returning", edits.length, "edits");
    return NextResponse.json({
      message: input.message,
      edits,
    });
  } catch (error) {
    console.error("Agent-edit error:", error);
    return NextResponse.json(
      { error: "Agent edit request failed" },
      { status: 500 }
    );
  }
}
