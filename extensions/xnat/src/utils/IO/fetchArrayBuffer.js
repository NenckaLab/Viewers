import makeCancelable from '../makeCancelable';
import sessionMap from '../sessionMap';

export default function fetchArrayBuffer(route, updateProgress) {
    const { xnatRootUrl } = sessionMap;

    return makeCancelable(
        new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Ensure no double slashes in URL construction
            const cleanRoute = route.startsWith('/') ? route.substring(1) : route;
            const baseUrl = xnatRootUrl.endsWith('/') ? xnatRootUrl : xnatRootUrl + '/';
            const url = `${baseUrl}${cleanRoute}`;


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