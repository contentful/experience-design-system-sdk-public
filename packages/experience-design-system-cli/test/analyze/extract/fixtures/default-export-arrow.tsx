export interface ILogoProps {
  item: {
    target?: string;
    linkUrl?: string;
    alt?: string;
    url?: string;
    label?: string;
  };
  verticalTop?: boolean;
}

const Logo = ({ item, verticalTop }: ILogoProps) => {
  return <div data-vertical={verticalTop}>{item.url}</div>;
};

export default Logo;
