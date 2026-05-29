interface CardProps {
  title: string;
  imageUrl?: string;
}

export const Card = ({ title, imageUrl }: CardProps) => {
  return (
    <div>
      <img src={imageUrl} />
      <h2>{title}</h2>
    </div>
  );
};

export default Card;
