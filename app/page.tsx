"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import styles from "./page.module.css";

type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
};

export default function Home() {
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleChatSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!input.trim() || isStreaming) return;

		const userInput = input;
		setInput("");

		const userMessage: ChatMessage = {
			id: uuidv4(),
			role: "user",
			content: userInput,
		};

		setMessages((prev) => [...prev, userMessage]);
		setIsStreaming(true);

		try {
			const response = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: userInput }),
			});

			if (!response.ok) {
				console.error("Error from chat API:", await response.text());
				return;
			}

			const assistantMessageId = uuidv4();
			setMessages((prev) => [
				...prev,
				{ id: assistantMessageId, role: "assistant", content: "" },
			]);

			const reader = response.body?.getReader();
			const decoder = new TextDecoder();
			let assistantResponse = "";

			if (reader) {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					assistantResponse += decoder.decode(value);
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? { ...msg, content: assistantResponse }
								: msg,
						),
					);
				}
			}
		} catch (error) {
			console.error("Error in chat:", error);
		} finally {
			setIsStreaming(false);
		}
	};

	return (
		<div className={styles.container}>
			<h1 className={styles.title}>SCOTUS Opinion Helper</h1>

			<div className={styles.panel}>
				<h2 className={styles.panelTitle}>
					Ask questions about uploaded opinions
				</h2>

				<div className={styles.messages}>
					{messages.length === 0 && (
						<div className={styles.welcome}>
							<p className={styles.welcomeText}>
								Upload opinions to Weaviate, then ask questions
								here.
							</p>
						</div>
					)}

					{messages.map((message) => (
						<div
							key={message.id}
							className={[
								styles.message,
								message.role === "user"
									? styles.user
									: styles.assistant,
							].join(" ")}
						>
							<p className={styles.messageHeader}>
								{message.role === "user" ? "You" : "Assistant"}
							</p>
							<p className={styles.messageBody}>
								{message.content}
							</p>
						</div>
					))}

					{isStreaming && !messages[messages.length - 1]?.content && (
						<div
							className={[
								styles.message,
								styles.assistant,
							].join(" ")}
						>
							<p className={styles.messageBody}>Thinking...</p>
						</div>
					)}

					<div ref={messagesEndRef} />
				</div>

				<form onSubmit={handleChatSubmit} className={styles.form}>
					<input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Ask a question about SCOTUS opinions..."
						className={styles.input}
						disabled={isStreaming}
					/>
					<button
						type="submit"
						disabled={isStreaming || !input.trim()}
						className={[
							styles.button,
							styles.sendButton,
						].join(" ")}
					>
						{isStreaming ? "Sending..." : "Send"}
					</button>
				</form>
			</div>
		</div>
	);
}

