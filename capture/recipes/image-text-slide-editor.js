/** Image and text beside the live preview, using a local bundled image. */
import { slideEditorShot } from './_slide-editor-shots.js';

export default slideEditorShot({
  id: 'image-text-slide-editor',
  type: 'image-text-slide',
  content: {
    title: 'Make room for a new perspective',
    body: 'A clear image and a short explanation help your audience follow the story.\n\n- One idea per slide\n- Space for the details that matter',
    image: '/assets/images/backgrounds/demo-moss.jpg',
    alt: 'Soft green abstract background',
    imageSide: 'right',
    imageWidth: 'half',
    fit: 'cover',
    background: 'mist',
  },
});
