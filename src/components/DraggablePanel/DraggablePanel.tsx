/**
 * 可拖拽面板容器组件
 * 仅桌面端支持拖拽，手机端保持固定布局
 */

import { useState, useRef, useEffect, useCallback } from 'react';

interface DraggablePanelProps {
  id: string;
  defaultPosition?: { x: number; y: number };
  onFocus?: () => void;
  zIndex?: number;
  children: React.ReactNode;
}

export function DraggablePanel({
  id,
  defaultPosition = { x: 16, y: 180 },
  onFocus,
  zIndex = 1000,
  children,
}: DraggablePanelProps) {
  const [position, setPosition] = useState(defaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // 检测是否桌面端
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 640);
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  // 开始拖拽
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isDesktop) return;

    // 点击输入控件/按钮等交互元素时，不进入拖拽逻辑（避免抢焦点/阻止输入）
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, button, a, [role="button"]')) return;

    // 只有点击面板顶部标题栏区域才能拖拽（前 48px）
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relativeY = e.clientY - rect.top;
    if (relativeY > 48) return;

    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    onFocus?.();
  }, [isDesktop, position, onFocus]);

  // 拖拽中
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragStartRef.current.x;
      const newY = e.clientY - dragStartRef.current.y;

      // 限制在视口内
      const maxX = window.innerWidth - (panelRef.current?.offsetWidth || 300);
      const maxY = window.innerHeight - 50;

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 点击面板时置顶
  const handlePanelClick = useCallback(() => {
    onFocus?.();
  }, [onFocus]);

  // 根节点鼠标按下：先置顶，再按需启动拖拽（仅标题栏区域且不点到交互控件）
  const handleRootMouseDown = useCallback((e: React.MouseEvent) => {
    handlePanelClick();
    handleMouseDown(e);
  }, [handlePanelClick, handleMouseDown]);


  // 手机端：不渲染（手机端内容在 MapContainer 的 sm:hidden 区域单独渲染）
  if (!isDesktop) {
    return null;
  }

  // 桌面端：可拖拽浮动面板
  return (
    <div
      ref={panelRef}
      data-panel-id={id}
      className="fixed"
      style={{
        left: position.x,
        top: position.y,
        zIndex,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
      onMouseDown={handleRootMouseDown}
    >      {children}
    </div>
  );
}

export default DraggablePanel;
