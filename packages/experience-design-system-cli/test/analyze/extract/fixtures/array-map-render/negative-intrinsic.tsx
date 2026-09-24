export type Tag = { name: string };

export type NegTagsProps = {
  tags: Tag[];
};

// Negative case: the callback returns an intrinsic element (<span/>), not a
// known local component. The signal must NOT fire.
export function NegTags({ tags }: NegTagsProps) {
  return (
    <div>
      {tags.map((tag, index) => (
        <span key={index}>{tag.name}</span>
      ))}
    </div>
  );
}
