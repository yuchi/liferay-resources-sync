
import { resolve } from 'path';
import { statSync } from 'fs';

const searchPath = (from, path) => {
  try {
    statSync(resolve(from, path));
    return from;
  }
  catch (err) {
    if (err.code === 'ENOENT') {
      const parent = resolve(from, '..');

      if (parent === from) {
        return null;
      }
      else {
        return searchPath(resolve(from, '..'), path);
      }
    }
    else {
      throw err;
    }
  }
};

export default searchPath;
