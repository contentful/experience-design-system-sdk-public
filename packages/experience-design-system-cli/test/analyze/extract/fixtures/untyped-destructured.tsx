export const ChecklistWrapper = ({ description, checklistItem1, checklistItem2, checklistItem3 }) => {
  return (
    <div>
      <p>{description}</p>
      <ul>
        <li>{checklistItem1}</li>
        <li>{checklistItem2}</li>
        <li>{checklistItem3}</li>
      </ul>
    </div>
  );
};
