import { createBasicFields } from './basic.js';
import { createBackgroundFields } from './background.js';
import { createColorFields } from './color.js';
import { createEnumFields } from './enum.js';
import { createIconFields } from './icons.js';
import { createImageFields } from './images/index.js';

export function createFieldRenderers(deps = {}) {
  const {
    fieldText,
    fieldNumber,
    fieldTextarea,
    fieldMarkdown,
    fieldCode,
    fieldSelect,
  } = createBasicFields();
  const { fieldEnum, fieldGrid } = createEnumFields({ ...deps, fieldSelect });
  const { fieldBackground } = createBackgroundFields(deps);
  const { fieldColor } = createColorFields();
  const { fieldIconPicker } = createIconFields();
  const { fieldImage, fieldTitleBgImage, fieldImages } =
    createImageFields(deps);

  return {
    fieldText,
    fieldNumber,
    fieldTextarea,
    fieldMarkdown,
    fieldCode,
    fieldEnum,
    fieldGrid,
    fieldBackground,
    fieldColor,
    fieldIconPicker,
    fieldImage,
    fieldTitleBgImage,
    fieldImages,
    openImagePicker: deps.openImagePicker,
  };
}
