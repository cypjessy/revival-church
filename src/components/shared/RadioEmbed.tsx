export default function RadioEmbed({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      frameBorder="0"
      // @ts-expect-error - React 19 requires lowercase HTML attributes
      allowtransparency="true"
      style={{ width: "100%", minHeight: "150px", height: "150px", border: 0 }}
      title={title}
    />
  );
}
