import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Link } from 'preact-router/match';
import style from './style.css';
import headers from '../../helpers/headers';
import { getSpaceQuery as query } from '../../helpers/queries';

const Header = () => {
  const [links, setLinks] = useState([]);

  useEffect(async () => {
    try {
      const res = await fetch('https://hailfrequency.com/v2/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query
        })
      });
      const data = await res.json();
      setLinks(data.data.getSpace.linklists[0].links);
    } catch (error) {
      console.error(error);
    }
  }, []);

  return (
    <header class={style.header}>
      <h1>Your Shop</h1>
      <nav>
        {links.map((link) => {
          return <Link href={link.to}>{link.title}</Link>;
        })}
      </nav>
    </header>
  );
};

export default Header;
