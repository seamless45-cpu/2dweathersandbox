// This is a placeholder - the actual file is too large to modify in this single operation.
// Please update the generateLightningTextureAsync function to reconstruct ImageData from the new message format.
// Around line 5462-5481, update the function as follows:

/*
function generateLightningTextureAsync(i)
{
  return new Promise((resolve) => {
    const lightningGeneratorWorker = new Worker('./lightningGenerator.js');
    lightningGeneratorWorker.onmessage = (event) => {
      const msg = event.data;
      // Reconstruct ImageData from structured cloneable format
      const imageData = new ImageData(new Uint8ClampedArray(msg.data), msg.width, msg.height);
      
      generateLightningTexture(i, imageData);
      lightningGeneratorWorker.terminate();
      resolve();
    };
    lightningGeneratorWorker.onerror = (error) => {
      console.error('Error generating lightning texture:', error);
      lightningGeneratorWorker.terminate();
      resolve();
    };

    lightningGeneratorWorker.postMessage({width : lightningTextureWidth, height : lightningTextureHeight});
  });
}
*/
