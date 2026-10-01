import { useLayoutEffect, useRef } from "react";

export default function MessageInput(props) {
  const input = useRef(null);
  useLayoutEffect(() => {
    const element = input.current;
    const resize = () => {
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
      element.style.overflowY = element.scrollHeight > 160 ? "auto" : "hidden";
    };
    resize();
    let width = element.parentElement.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.parentElement.clientWidth;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    // Observe the container so viewport changes also reflow long drafts.
    observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={input} />;
}
