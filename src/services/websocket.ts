/**
 * Marfyl WebSocket Service
 *
 * Socket.io WebSocket server for real-time chat streaming
 * and push notifications.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { ChatHandler, ChatMessage } from "../ai/chatHandler";

// ============================================
// Types
// ============================================

export interface ChatRoom {
  id: string;
  organizationId: number;
  userId?: number;
  createdAt: Date;
}

export interface ChatSession {
  id: string;
  roomId: string;
  history: ChatMessage[];
  context?: string;
  orgName?: string;
  userRole?: string;
}

export interface WSChatMessage {
  type:
    | "message"
    | "typing"
    | "tool_call"
    | "tool_result"
    | "error"
    | "connected";
  payload: unknown;
  timestamp?: number;
}

export interface SendMessagePayload {
  message: string;
  history?: ChatMessage[];
  context?: string;
  orgName?: string;
  userRole?: string;
}

export interface StreamingChunkPayload {
  chunk: string;
  done: boolean;
}

// ============================================
// Constants
// ============================================

const NAMESPACE = "/chat";
const ROOM_PREFIX = "org_";
const SESSION_PREFIX = "session_";
const TYPING_TIMEOUT = 3000;

// ============================================
// Socket Auth Middleware
// ============================================

interface AuthenticatedSocket extends Socket {
  userId?: number;
  organizationId?: number;
}

// ============================================
// WebSocket Service
// ============================================

@Injectable()
export class WebSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebSocketService.name);
  private io: Server | null = null;
  private rooms: Map<string, ChatRoom> = new Map();
  private sessions: Map<string, ChatSession> = new Map();
  private typingTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly config: ConfigService,
    private readonly chatHandler: ChatHandler,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Initialize Socket.io server
   */
  async onModuleInit(): Promise<void> {
    this.logger.log("WebSocket service initializing...");
  }

  /**
   * Attach Socket.io to existing HTTP server
   */
  attachToServer(httpServer: HttpServer): void {
    if (this.io) {
      this.logger.warn("Socket.io server already initialized");
      return;
    }

    const corsOrigins = [
      this.config.get<string>("FRONTEND_URL", "http://localhost:3002"),
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
    ];

    this.io = new Server(httpServer, {
      cors: {
        origin: corsOrigins,
        credentials: true,
        methods: ["GET", "POST"],
      },
      transports: ["websocket", "polling"],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Authentication middleware — real JWT validation
    this.io.use((socket: AuthenticatedSocket, next) => {
      const rawToken =
        socket.handshake.auth.token || socket.handshake.headers.authorization;

      // Strip "Bearer " prefix if present
      const token =
        typeof rawToken === "string"
          ? rawToken.replace(/^Bearer\s+/i, "")
          : undefined;

      // SECURITY: Always require JWT authentication, regardless of environment
      // Previously, development/QA allowed unauthenticated connections, which was
      // a security risk in staging environments. All connections must now be
      // authenticated with a valid JWT token.
      if (!token) {
        this.logger.warn(
          `WebSocket connection rejected: no token provided (${socket.id})`,
        );
        socket.emit("error", { message: "Authentication required" });
        return next(new Error("Authentication required"));
      }

      try {
        // Validate JWT signature and expiration
        const payload = this.jwtService.verify<{
          sub: number;
          email?: string;
          isSuperAdmin?: boolean;
          organizationId?: number;
        }>(token);

        // Attach validated identity to socket
        socket.userId = payload.sub;
        socket.organizationId =
          socket.organizationId ?? payload.organizationId;

        this.logger.debug(
          `JWT validated for user ${payload.sub}, org ${payload.organizationId}`,
        );

        return next();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid token";
        this.logger.warn(`JWT validation failed for ${socket.id}: ${message}`);
        return next(new Error("Authentication required"));
      }
    });

    // Register namespace handlers
    this.registerNamespaceHandlers();

    this.logger.log(`Socket.io server initialized on namespace ${NAMESPACE}`);
  }

  /**
   * Register handlers for the chat namespace
   */
  private registerNamespaceHandlers(): void {
    if (!this.io) return;

    const chatNamespace = this.io.of(NAMESPACE);

    chatNamespace.on("connection", (socket: AuthenticatedSocket) => {
      const { organizationId } = socket;

      this.logger.log(`Client connected: ${socket.id}, org: ${organizationId}`);

      // Send connected confirmation
      this.sendToSocket(socket, {
        type: "connected",
        payload: {
          socketId: socket.id,
          organizationId,
          message: "Conectado al asistente MARFYL",
        },
        timestamp: Date.now(),
      });

      // Join organization room
      if (organizationId) {
        const roomId = `${ROOM_PREFIX}${organizationId}`;
        socket.join(roomId);

        // Track room
        if (!this.rooms.has(roomId)) {
          this.rooms.set(roomId, {
            id: roomId,
            organizationId,
            createdAt: new Date(),
          });
        }

        this.logger.log(`Socket ${socket.id} joined room ${roomId}`);
      }

      // Handle new chat message
      socket.on("message", async (payload: SendMessagePayload) => {
        await this.handleMessage(socket, payload);
      });

      // Handle typing indicator
      socket.on("typing", (isTyping: boolean) => {
        this.handleTyping(socket, isTyping);
      });

      // Handle history update
      socket.on(
        "update_history",
        (sessionId: string, history: ChatMessage[]) => {
          this.updateSessionHistory(sessionId, history);
        },
      );

      // Handle clear history
      socket.on("clear_history", (sessionId: string) => {
        this.clearSessionHistory(sessionId);
      });

      // Handle disconnect
      socket.on("disconnect", (reason) => {
        this.logger.log(`Client disconnected: ${socket.id}, reason: ${reason}`);
        this.cleanupTyping(socket.id);
      });
    });
  }

  /**
   * Handle incoming chat message
   */
  private async handleMessage(
    socket: AuthenticatedSocket,
    payload: SendMessagePayload,
  ): Promise<void> {
    const { message, context, orgName, userRole } = payload;
    const sessionId = socket.data.sessionId || `${SESSION_PREFIX}${socket.id}`;

    if (!message?.trim()) {
      this.sendToSocket(socket, {
        type: "error",
        payload: { message: "Mensaje vacío" },
        timestamp: Date.now(),
      });
      return;
    }

    // Create or update session
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        roomId: `${ROOM_PREFIX}${socket.organizationId}`,
        history: [],
        context,
        orgName,
        userRole,
      });
      socket.data.sessionId = sessionId;
    }

    // Add user message to history
    const session = this.sessions.get(sessionId)!;
    session.history.push({ role: "user", content: message });

    try {
      // Send typing indicator
      this.sendTypingToRoom(socket, true);

      // Use streaming chat
      const fullReply: string[] = [];

      const response = await this.chatHandler.chatStream(
        {
          message,
          history: session.history.slice(-8), // Last 8 messages for context
          context,
          orgName,
          userRole,
        },
        async (chunk: string) => {
          fullReply.push(chunk);

          // Stream chunk to client
          this.sendToSocket(socket, {
            type: "message",
            payload: {
              chunk,
              done: false,
            } as StreamingChunkPayload,
            timestamp: Date.now(),
          });
        },
      );

      // Send final chunk
      this.sendToSocket(socket, {
        type: "message",
        payload: {
          chunk: "",
          done: true,
          fullReply: response.reply,
          model: response.model,
        } as StreamingChunkPayload,
        timestamp: Date.now(),
      });

      // Add assistant response to history
      session.history.push({ role: "model", content: response.reply });

      // Send tool usage info if any
      if (response.toolsUsed && response.toolsUsed.length > 0) {
        this.sendToSocket(socket, {
          type: "tool_call",
          payload: { tools: response.toolsUsed },
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error desconocido";
      this.logger.error(`Chat error: ${errorMessage}`);

      this.sendToSocket(socket, {
        type: "error",
        payload: { message: errorMessage },
        timestamp: Date.now(),
      });
    } finally {
      // Stop typing indicator
      this.sendTypingToRoom(socket, false);
    }
  }

  /**
   * Handle typing indicator
   */
  private handleTyping(socket: AuthenticatedSocket, isTyping: boolean): void {
    const roomId = `${ROOM_PREFIX}${socket.organizationId}`;

    if (isTyping) {
      // Broadcast typing to room (excluding sender)
      socket.to(roomId).emit("typing", {
        socketId: socket.id,
        isTyping: true,
      });

      // Set timeout to clear typing
      const existingTimer = this.typingTimers.get(socket.id);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        this.sendTypingToRoom(socket, false);
        this.typingTimers.delete(socket.id);
      }, TYPING_TIMEOUT);

      this.typingTimers.set(socket.id, timer);
    } else {
      this.cleanupTyping(socket.id);
      this.sendTypingToRoom(socket, false);
    }
  }

  /**
   * Send typing indicator to room
   */
  private sendTypingToRoom(
    socket: AuthenticatedSocket,
    isTyping: boolean,
  ): void {
    const roomId = `${ROOM_PREFIX}${socket.organizationId}`;
    socket.to(roomId).emit("typing", {
      socketId: socket.id,
      isTyping,
    });
  }

  /**
   * Cleanup typing timer
   */
  private cleanupTyping(socketId: string): void {
    const timer = this.typingTimers.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(socketId);
    }
  }

  /**
   * Update session history
   */
  private updateSessionHistory(
    sessionId: string,
    history: ChatMessage[],
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.history = history.slice(-16); // Keep last 16 messages
    }
  }

  /**
   * Clear session history
   */
  private clearSessionHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.history = [];
    }
  }

  /**
   * Send message to specific socket
   */
  private sendToSocket(socket: Socket, message: WSChatMessage): void {
    socket.emit("event", message);
  }

  /**
   * Broadcast to all sockets in organization room
   */
  broadcastToOrg(organizationId: number, message: WSChatMessage): void {
    if (!this.io) return;

    const roomId = `${ROOM_PREFIX}${organizationId}`;
    this.io.to(roomId).emit("event", message);
  }

  /**
   * Get room info
   */
  getRoomInfo(roomId: string): ChatRoom | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Get session info
   */
  getSessionInfo(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get active connection count
   */
  getConnectionCount(): number {
    return this.io?.sockets?.sockets?.size ?? 0;
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log("WebSocket service shutting down...");

    // Clear all typing timers
    for (const timer of this.typingTimers.values()) {
      clearTimeout(timer);
    }
    this.typingTimers.clear();

    // Disconnect all sockets
    if (this.io) {
      await new Promise<void>((resolve) => {
        this.io!.close(() => {
          this.logger.log("Socket.io server closed");
          resolve();
        });
      });
    }

    // Clear maps
    this.rooms.clear();
    this.sessions.clear();
  }
}
