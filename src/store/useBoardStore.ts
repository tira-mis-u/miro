import { create } from 'zustand';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// Khởi tạo Yjs Document (Cấu trúc dữ liệu phi tập trung)
export const ydoc = new Y.Doc();

// yShapes là một map đóng vai trò là kho chứa toàn bộ các đối tượng hình vẽ.
export const yShapes = ydoc.getMap('shapes');

// Kết nối đến Backend Socket (Chạy port 1234 từ root)
export const provider = new WebsocketProvider(
  'ws://localhost:1234',
  'board-1', // Tên phòng / Board ID
  ydoc,
  { connect: true }
);

interface UIState {
  tool: 'cursor' | 'pen' | 'rect';
  camera: { x: number; y: number; zoom: number };
  setTool: (tool: 'cursor' | 'pen' | 'rect') => void;
  setCamera: (camera: { x: number; y: number; zoom: number }) => void;
}

// Lưu trữ trạng thái UI (Local UI, không truyền qua mạng trừ con trỏ chuột)
export const useUIStore = create<UIState>((set) => ({
  tool: 'pen', // Mặc định là bút vẽ
  camera: { x: 0, y: 0, zoom: 1 },
  setTool: (tool) => set({ tool }),
  setCamera: (camera) => set({ camera }),
}));
