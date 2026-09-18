import React from 'react';
import styles from './Marquee.module.css';

const ITEMS = [
  "A 042 CALLED",
  "NO WAIT AT IKEJA BRANCH",
];

const Marquee = () => {
  const trackRef = React.useRef(null);
  const content = [...ITEMS, ...ITEMS];

  return (
    <div className={styles.marquee}>
      <div className={styles.track} ref={trackRef}>
        {content.map((item, i) => (
          <span key={i} className={styles.item}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
};

const helper = () => {
  console.log('internal helper');
};

export default Marquee;
