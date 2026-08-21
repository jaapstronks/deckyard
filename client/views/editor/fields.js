import { createBasicFields } from './fields/basic.js';
import { createBackgroundFields } from './fields/background.js';
import { createColorFields } from './fields/color.js';
import { createEnumFields } from './fields/enum.js';
import { createIconFields } from './fields/icons.js';
import { createImageFields } from './fields/images.js';

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
  };
}
