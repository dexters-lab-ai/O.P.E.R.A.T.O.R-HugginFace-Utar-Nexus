import {
  FileLoader,
  Loader,
  ShapePath
} from "./chunk-MYETRLG2.js";
import "./chunk-BUSYA2B4.js";

// node_modules/three/examples/jsm/loaders/FontLoader.js
var FontLoader = class extends Loader {
  /**
   * Constructs a new font loader.
   *
   * @param {LoadingManager} [manager] - The loading manager.
   */
  constructor(manager) {
    super(manager);
  }
  /**
   * Starts loading from the given URL and passes the loaded font
   * to the `onLoad()` callback.
   *
   * @param {string} url - The path/URL of the file to be loaded. This can also be a data URI.
   * @param {function(Font)} onLoad - Executed when the loading process has been finished.
   * @param {onProgressCallback} onProgress - Executed while the loading is in progress.
   * @param {onErrorCallback} onError - Executed when errors occur.
   */
  load(url, onLoad, onProgress, onError) {
    const scope = this;
    const loader = new FileLoader(this.manager);
    loader.setPath(this.path);
    loader.setRequestHeader(this.requestHeader);
    loader.setWithCredentials(this.withCredentials);
    loader.load(url, function(text) {
      const font = scope.parse(JSON.parse(text));
      if (onLoad) onLoad(font);
    }, onProgress, onError);
  }
  /**
   * Parses the given font data and returns the resulting font.
   *
   * @param {Object} json - The raw font data as a JSON object.
   * @return {Font} The font.
   */
  parse(json) {
    return new Font(json);
  }
};
var Font = class {
  /**
   * Constructs a new font.
   *
   * @param {Object} data - The font data as JSON.
   */
  constructor(data) {
    this.isFont = true;
    this.type = "Font";
    this.data = data;
  }
  /**
   * Generates geometry shapes from the given text and size. The result of this method
   * should be used with {@link ShapeGeometry} to generate the actual geometry data.
   *
   * @param {string} text - The text.
   * @param {number} [size=100] - The text size.
   * @return {Array<Shape>} An array of shapes representing the text.
   */
  generateShapes(text, size = 100) {
    const shapes = [];
    const paths = createPaths(text, size, this.data);
    for (let p = 0, pl = paths.length; p < pl; p++) {
      shapes.push(...paths[p].toShapes());
    }
    return shapes;
  }
};
function createPaths(text, size, data) {
  const chars = Array.from(text);
  const scale = size / data.resolution;
  const line_height = (data.boundingBox.yMax - data.boundingBox.yMin + data.underlineThickness) * scale;
  const paths = [];
  let offsetX = 0, offsetY = 0;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === "\n") {
      offsetX = 0;
      offsetY -= line_height;
    } else {
      const ret = createPath(char, scale, offsetX, offsetY, data);
      offsetX += ret.offsetX;
      paths.push(ret.path);
    }
  }
  return paths;
}
function createPath(char, scale, offsetX, offsetY, data) {
  const glyph = data.glyphs[char] || data.glyphs["?"];
  if (!glyph) {
    console.error('THREE.Font: character "' + char + '" does not exists in font family ' + data.familyName + ".");
    return;
  }
  const path = new ShapePath();
  let x, y, cpx, cpy, cpx1, cpy1, cpx2, cpy2;
  if (glyph.o) {
    const outline = glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(" "));
    for (let i = 0, l = outline.length; i < l; ) {
      const action = outline[i++];
      switch (action) {
        case "m":
          x = outline[i++] * scale + offsetX;
          y = outline[i++] * scale + offsetY;
          path.moveTo(x, y);
          break;
        case "l":
          x = outline[i++] * scale + offsetX;
          y = outline[i++] * scale + offsetY;
          path.lineTo(x, y);
          break;
        case "q":
          cpx = outline[i++] * scale + offsetX;
          cpy = outline[i++] * scale + offsetY;
          cpx1 = outline[i++] * scale + offsetX;
          cpy1 = outline[i++] * scale + offsetY;
          path.quadraticCurveTo(cpx1, cpy1, cpx, cpy);
          break;
        case "b":
          cpx = outline[i++] * scale + offsetX;
          cpy = outline[i++] * scale + offsetY;
          cpx1 = outline[i++] * scale + offsetX;
          cpy1 = outline[i++] * scale + offsetY;
          cpx2 = outline[i++] * scale + offsetX;
          cpy2 = outline[i++] * scale + offsetY;
          path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, cpx, cpy);
          break;
      }
    }
  }
  return { offsetX: glyph.ha * scale, path };
}
export {
  Font,
  FontLoader
};
//# sourceMappingURL=three_examples_jsm_loaders_FontLoader__js.js.map
