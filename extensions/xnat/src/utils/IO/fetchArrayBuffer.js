import makeCancelable from '../makeCancelable';
import sessionMap from '../sessionMap';

export default function fetchArrayBuffer(route, updateProgress) {
    return makeCancelable(
        new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const url = sessionMap.joinUrl(route);


            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve(xhr.response);
                } else {
                    resolve(null);
                }
            };

            xhr.onerror = () => {
                reject(xhr.responseText);
            };

            if (updateProgress) {
                xhr.onprogress = async evt => {
                    const percentComplete = Math.floor((evt.loaded / evt.total) * 100);
                    updateProgress(`Downloading File: ${percentComplete}%`);
                };
            }

            xhr.open('GET', url);
            xhr.responseType = 'arraybuffer';
            xhr.send();
        })
    );
}