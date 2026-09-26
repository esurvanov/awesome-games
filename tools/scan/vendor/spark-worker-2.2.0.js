/* Spark 2.2.0 (MIT, github.com/sparkjsdev/spark) — inline worker extracted by make-spark-worker.mjs */
(function() {
  "use strict";
  class ChunkDecoder {
    static __wrap(ptr) {
      ptr = ptr >>> 0;
      const obj = Object.create(ChunkDecoder.prototype);
      obj.__wbg_ptr = ptr;
      ChunkDecoderFinalization.register(obj, obj.__wbg_ptr, obj);
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.__wbg_ptr;
      this.__wbg_ptr = 0;
      ChunkDecoderFinalization.unregister(this);
      return ptr;
    }
    free() {
      const ptr = this.__destroy_into_raw();
      wasm.__wbg_chunkdecoder_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    finish() {
      const ptr = this.__destroy_into_raw();
      const ret = wasm.chunkdecoder_finish(ptr);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Uint8Array} bytes
     */
    push(bytes) {
      const ret = wasm.chunkdecoder_push(this.__wbg_ptr, bytes);
      if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
      }
    }
  }
  if (Symbol.dispose) ChunkDecoder.prototype[Symbol.dispose] = ChunkDecoder.prototype.free;
  class CsplatArray {
    static __wrap(ptr) {
      ptr = ptr >>> 0;
      const obj = Object.create(CsplatArray.prototype);
      obj.__wbg_ptr = ptr;
      CsplatArrayFinalization.register(obj, obj.__wbg_ptr, obj);
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.__wbg_ptr;
      this.__wbg_ptr = 0;
      CsplatArrayFinalization.unregister(this);
      return ptr;
    }
    free() {
      const ptr = this.__destroy_into_raw();
      wasm.__wbg_csplatarray_free(ptr, 0);
    }
    /**
     * @param {number} lod_base
     */
    bhatt_lod(lod_base) {
      wasm.csplatarray_bhatt_lod(this.__wbg_ptr, lod_base);
    }
    /**
     * @returns {boolean}
     */
    has_lod() {
      const ret = wasm.csplatarray_has_lod(this.__wbg_ptr);
      return ret !== 0;
    }
    /**
     * @param {Uint8Array} rgba
     */
    inject_rgba8(rgba) {
      wasm.csplatarray_inject_rgba8(this.__wbg_ptr, rgba);
    }
    /**
     * @returns {number}
     */
    len() {
      const ret = wasm.csplatarray_len(this.__wbg_ptr);
      return ret >>> 0;
    }
    /**
     * @param {number} lod_base
     * @param {boolean} merge_filter
     */
    tiny_lod(lod_base, merge_filter) {
      wasm.csplatarray_tiny_lod(this.__wbg_ptr, lod_base, merge_filter);
    }
    /**
     * @returns {object}
     */
    to_extsplats() {
      const ret = wasm.csplatarray_to_extsplats(this.__wbg_ptr);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {object}
     */
    to_extsplats_lod() {
      const ret = wasm.csplatarray_to_extsplats_lod(this.__wbg_ptr);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {object}
     */
    to_packedsplats() {
      const ret = wasm.csplatarray_to_packedsplats(this.__wbg_ptr);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {object}
     */
    to_packedsplats_lod() {
      const ret = wasm.csplatarray_to_packedsplats_lod(this.__wbg_ptr);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {number}
     */
    get maxShDegree() {
      const ret = wasm.__wbg_get_csplatarray_maxShDegree(this.__wbg_ptr);
      return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get numSplats() {
      const ret = wasm.__wbg_get_csplatarray_numSplats(this.__wbg_ptr);
      return ret >>> 0;
    }
    /**
     * @param {number} arg0
     */
    set maxShDegree(arg0) {
      wasm.__wbg_set_csplatarray_maxShDegree(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set numSplats(arg0) {
      wasm.__wbg_set_csplatarray_numSplats(this.__wbg_ptr, arg0);
    }
  }
  if (Symbol.dispose) CsplatArray.prototype[Symbol.dispose] = CsplatArray.prototype.free;
  class GsplatArray {
    static __wrap(ptr) {
      ptr = ptr >>> 0;
      const obj = Object.create(GsplatArray.prototype);
      obj.__wbg_ptr = ptr;
      GsplatArrayFinalization.register(obj, obj.__wbg_ptr, obj);
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.__wbg_ptr;
      this.__wbg_ptr = 0;
      GsplatArrayFinalization.unregister(this);
      return ptr;
    }
    free() {
      const ptr = this.__destroy_into_raw();
      wasm.__wbg_gsplatarray_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get maxShDegree() {
      const ret = wasm.__wbg_get_gsplatarray_maxShDegree(this.__wbg_ptr);
      return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get numSplats() {
      const ret = wasm.__wbg_get_gsplatarray_numSplats(this.__wbg_ptr);
      return ret >>> 0;
    }
    /**
     * @param {number} lod_base
     */
    bhatt_lod(lod_base) {
      wasm.gsplatarray_bhatt_lod(this.__wbg_ptr, lod_base);
    }
    /**
     * @param {GsplatArray} other
     */
    concat(other) {
      _assertClass(other, GsplatArray);
      const ret = wasm.gsplatarray_concat(this.__wbg_ptr, other.__wbg_ptr);
      if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
      }
    }
    /**
     * @param {number} max_sh
     * @param {number} fractional_bits
     * @returns {Uint8Array}
     */
    encode_to_spz(max_sh, fractional_bits) {
      const ptr = this.__destroy_into_raw();
      const ret = wasm.gsplatarray_encode_to_spz(ptr, max_sh, fractional_bits);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {boolean}
     */
    has_lod() {
      const ret = wasm.gsplatarray_has_lod(this.__wbg_ptr);
      return ret !== 0;
    }
    /**
     * @param {Uint8Array} rgba
     */
    inject_rgba8(rgba) {
      wasm.gsplatarray_inject_rgba8(this.__wbg_ptr, rgba);
    }
    /**
     * @returns {number}
     */
    len() {
      const ret = wasm.gsplatarray_len(this.__wbg_ptr);
      return ret >>> 0;
    }
    /**
     * @param {number} lod_base
     * @param {boolean} merge_filter
     */
    tiny_lod(lod_base, merge_filter) {
      wasm.gsplatarray_tiny_lod(this.__wbg_ptr, lod_base, merge_filter);
    }
    /**
     * @returns {object}
     */
    to_extsplats() {
      const ret = wasm.gsplatarray_to_extsplats(this.__wbg_ptr);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {object}
     */
    to_extsplats_lod() {
      const ret = wasm.gsplatarray_to_extsplats_lod(this.__wbg_ptr);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} encoding
     * @returns {object}
     */
    to_packedsplats(encoding) {
      const ret = wasm.gsplatarray_to_packedsplats(this.__wbg_ptr, encoding);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} encoding
     * @returns {object}
     */
    to_packedsplats_lod(encoding) {
      const ret = wasm.gsplatarray_to_packedsplats_lod(this.__wbg_ptr, encoding);
      if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
      }
      return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} transform
     */
    transform(transform) {
      const ret = wasm.gsplatarray_transform(this.__wbg_ptr, transform);
      if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
      }
    }
    /**
     * @param {number} arg0
     */
    set maxShDegree(arg0) {
      wasm.__wbg_set_gsplatarray_maxShDegree(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set numSplats(arg0) {
      wasm.__wbg_set_gsplatarray_numSplats(this.__wbg_ptr, arg0);
    }
  }
  if (Symbol.dispose) GsplatArray.prototype[Symbol.dispose] = GsplatArray.prototype.free;
  function bhatt_lod_extsplats(num_splats, ext1, ext2, extra, lod_base, rgba) {
    const ret = wasm.bhatt_lod_extsplats(num_splats, ext1, ext2, isLikeNone(extra) ? 0 : addToExternrefTable0(extra), lod_base, isLikeNone(rgba) ? 0 : addToExternrefTable0(rgba));
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function bhatt_lod_packedsplats(num_splats, packed, extra, lod_base, rgba, encoding) {
    const ret = wasm.bhatt_lod_packedsplats(num_splats, packed, isLikeNone(extra) ? 0 : addToExternrefTable0(extra), lod_base, isLikeNone(rgba) ? 0 : addToExternrefTable0(rgba), encoding);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function decode_to_csplatarray(file_type, path_name, encoding) {
    var ptr0 = isLikeNone(file_type) ? 0 : passStringToWasm0(file_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(path_name) ? 0 : passStringToWasm0(path_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.decode_to_csplatarray(ptr0, len0, ptr1, len1, encoding);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ChunkDecoder.__wrap(ret[0]);
  }
  function decode_to_extsplats(file_type, path_name, sh1_codes, sh2_codes, sh3_codes) {
    var ptr0 = isLikeNone(file_type) ? 0 : passStringToWasm0(file_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(path_name) ? 0 : passStringToWasm0(path_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.decode_to_extsplats(ptr0, len0, ptr1, len1, isLikeNone(sh1_codes) ? 0 : addToExternrefTable0(sh1_codes), isLikeNone(sh2_codes) ? 0 : addToExternrefTable0(sh2_codes), isLikeNone(sh3_codes) ? 0 : addToExternrefTable0(sh3_codes));
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ChunkDecoder.__wrap(ret[0]);
  }
  function decode_to_gsplatarray(file_type, path_name) {
    var ptr0 = isLikeNone(file_type) ? 0 : passStringToWasm0(file_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(path_name) ? 0 : passStringToWasm0(path_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.decode_to_gsplatarray(ptr0, len0, ptr1, len1);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ChunkDecoder.__wrap(ret[0]);
  }
  function decode_to_packedsplats(file_type, path_name, encoding, sh1_codes, sh2_codes, sh3_codes) {
    var ptr0 = isLikeNone(file_type) ? 0 : passStringToWasm0(file_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(path_name) ? 0 : passStringToWasm0(path_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.decode_to_packedsplats(ptr0, len0, ptr1, len1, encoding, isLikeNone(sh1_codes) ? 0 : addToExternrefTable0(sh1_codes), isLikeNone(sh2_codes) ? 0 : addToExternrefTable0(sh2_codes), isLikeNone(sh3_codes) ? 0 : addToExternrefTable0(sh3_codes));
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ChunkDecoder.__wrap(ret[0]);
  }
  function dispose_lod_tree(lod_id) {
    wasm.dispose_lod_tree(lod_id);
  }
  function dynamic_traverse_lod_trees(max_splats, pixel_scale_limit, _last_pixel_limit, lod_ids, root_pages, view_to_objects, lod_scales, behind_foveates, cone_foveates, cone_fov0s, cone_fovs) {
    const ptr0 = passArray32ToWasm0(lod_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(root_pages, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(view_to_objects, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF32ToWasm0(lod_scales, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArrayF32ToWasm0(behind_foveates, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArrayF32ToWasm0(cone_foveates, wasm.__wbindgen_malloc);
    const len5 = WASM_VECTOR_LEN;
    const ptr6 = passArrayF32ToWasm0(cone_fov0s, wasm.__wbindgen_malloc);
    const len6 = WASM_VECTOR_LEN;
    const ptr7 = passArrayF32ToWasm0(cone_fovs, wasm.__wbindgen_malloc);
    const len7 = WASM_VECTOR_LEN;
    const ret = wasm.dynamic_traverse_lod_trees(max_splats, pixel_scale_limit, isLikeNone(_last_pixel_limit) ? 4294967297 : Math.fround(_last_pixel_limit), ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function get_lod_tree_level(lod_id, level) {
    const ret = wasm.get_lod_tree_level(lod_id, level);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function init_lod_tree(num_splats, lod_tree) {
    const ret = wasm.init_lod_tree(num_splats, lod_tree);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function new_lod_tree(capacity) {
    const ret = wasm.new_lod_tree(capacity);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function new_shared_lod_tree(orig_lod_id) {
    const ret = wasm.new_shared_lod_tree(orig_lod_id);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function sort32_splats(num_splats, readback, ordering) {
    const ret = wasm.sort32_splats(num_splats, readback, ordering);
    return ret >>> 0;
  }
  function sort_splats(num_splats, readback, ordering) {
    const ret = wasm.sort_splats(num_splats, readback, ordering);
    return ret >>> 0;
  }
  function tiny_lod_extsplats(num_splats, ext1, ext2, extra, lod_base, merge_filter, rgba) {
    const ret = wasm.tiny_lod_extsplats(num_splats, ext1, ext2, isLikeNone(extra) ? 0 : addToExternrefTable0(extra), lod_base, merge_filter, isLikeNone(rgba) ? 0 : addToExternrefTable0(rgba));
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function tiny_lod_packedsplats(num_splats, packed, extra, lod_base, merge_filter, rgba, encoding) {
    const ret = wasm.tiny_lod_packedsplats(num_splats, packed, isLikeNone(extra) ? 0 : addToExternrefTable0(extra), lod_base, merge_filter, isLikeNone(rgba) ? 0 : addToExternrefTable0(rgba), encoding);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function traverse_lod_trees(max_splats, pixel_scale_limit, _last_pixel_limit, lod_ids, root_pages, view_to_objects, lod_scales, behind_foveates, cone_foveates, cone_fov0s, cone_fovs) {
    const ptr0 = passArray32ToWasm0(lod_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(root_pages, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(view_to_objects, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF32ToWasm0(lod_scales, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArrayF32ToWasm0(behind_foveates, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArrayF32ToWasm0(cone_foveates, wasm.__wbindgen_malloc);
    const len5 = WASM_VECTOR_LEN;
    const ptr6 = passArrayF32ToWasm0(cone_fov0s, wasm.__wbindgen_malloc);
    const len6 = WASM_VECTOR_LEN;
    const ptr7 = passArrayF32ToWasm0(cone_fovs, wasm.__wbindgen_malloc);
    const len7 = WASM_VECTOR_LEN;
    const ret = wasm.traverse_lod_trees(max_splats, pixel_scale_limit, isLikeNone(_last_pixel_limit) ? 4294967297 : Math.fround(_last_pixel_limit), ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function update_lod_trees(lod_ids, page_bases, chunk_bases, counts, lod_trees) {
    const ptr0 = passArray32ToWasm0(lod_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(page_bases, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray32ToWasm0(chunk_bases, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray32ToWasm0(counts, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.update_lod_trees(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, lod_trees);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
  }
  function __wbg_get_imports() {
    const import0 = {
      __proto__: null,
      __wbg_Error_2e59b1b37a9a34c3: function(arg0, arg1) {
        const ret = Error(getStringFromWasm0(arg0, arg1));
        return ret;
      },
      __wbg___wbindgen_boolean_get_a86c216575a75c30: function(arg0) {
        const v = arg0;
        const ret = typeof v === "boolean" ? v : void 0;
        return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;
      },
      __wbg___wbindgen_debug_string_dd5d2d07ce9e6c57: function(arg0, arg1) {
        const ret = debugString(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg___wbindgen_in_4bd7a57e54337366: function(arg0, arg1) {
        const ret = arg0 in arg1;
        return ret;
      },
      __wbg___wbindgen_is_falsy_c6ddfae1bb56d5ef: function(arg0) {
        const ret = !arg0;
        return ret;
      },
      __wbg___wbindgen_is_function_49868bde5eb1e745: function(arg0) {
        const ret = typeof arg0 === "function";
        return ret;
      },
      __wbg___wbindgen_is_object_40c5a80572e8f9d3: function(arg0) {
        const val = arg0;
        const ret = typeof val === "object" && val !== null;
        return ret;
      },
      __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: function(arg0) {
        const ret = arg0 === void 0;
        return ret;
      },
      __wbg___wbindgen_jsval_loose_eq_3a72ae764d46d944: function(arg0, arg1) {
        const ret = arg0 == arg1;
        return ret;
      },
      __wbg___wbindgen_number_get_7579aab02a8a620c: function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof obj === "number" ? obj : void 0;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
      },
      __wbg___wbindgen_string_get_914df97fcfa788f2: function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof obj === "string" ? obj : void 0;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg___wbindgen_throw_81fc77679af83bc6: function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
      },
      __wbg_call_7f2987183bb62793: function() {
        return handleError(function(arg0, arg1) {
          const ret = arg0.call(arg1);
          return ret;
        }, arguments);
      },
      __wbg_csplatarray_new: function(arg0) {
        const ret = CsplatArray.__wrap(arg0);
        return ret;
      },
      __wbg_done_547d467e97529006: function(arg0) {
        const ret = arg0.done;
        return ret;
      },
      __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
          deferred0_0 = arg0;
          deferred0_1 = arg1;
          console.error(getStringFromWasm0(arg0, arg1));
        } finally {
          wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
      },
      __wbg_get_4848e350b40afc16: function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
      },
      __wbg_get_ed0642c4b9d31ddf: function() {
        return handleError(function(arg0, arg1) {
          const ret = Reflect.get(arg0, arg1);
          return ret;
        }, arguments);
      },
      __wbg_get_f96702c6245e4ef9: function() {
        return handleError(function(arg0, arg1) {
          const ret = Reflect.get(arg0, arg1);
          return ret;
        }, arguments);
      },
      __wbg_get_unchecked_7d7babe32e9e6a54: function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
      },
      __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
        const ret = arg0[arg1];
        return ret;
      },
      __wbg_gsplatarray_new: function(arg0) {
        const ret = GsplatArray.__wrap(arg0);
        return ret;
      },
      __wbg_instanceof_ArrayBuffer_ff7c1337a5e3b33a: function(arg0) {
        let result;
        try {
          result = arg0 instanceof ArrayBuffer;
        } catch (_) {
          result = false;
        }
        const ret = result;
        return ret;
      },
      __wbg_instanceof_Uint8Array_4b8da683deb25d72: function(arg0) {
        let result;
        try {
          result = arg0 instanceof Uint8Array;
        } catch (_) {
          result = false;
        }
        const ret = result;
        return ret;
      },
      __wbg_isArray_db61795ad004c139: function(arg0) {
        const ret = Array.isArray(arg0);
        return ret;
      },
      __wbg_iterator_de403ef31815a3e6: function() {
        const ret = Symbol.iterator;
        return ret;
      },
      __wbg_length_0c32cb8543c8e4c8: function(arg0) {
        const ret = arg0.length;
        return ret;
      },
      __wbg_length_1e701798fdcaa3b4: function(arg0) {
        const ret = arg0.length;
        return ret;
      },
      __wbg_length_6e821edde497a532: function(arg0) {
        const ret = arg0.length;
        return ret;
      },
      __wbg_length_a4ca9e78359b5f1f: function(arg0) {
        const ret = arg0.length;
        return ret;
      },
      __wbg_length_fd4646b401926788: function(arg0) {
        const ret = arg0.length;
        return ret;
      },
      __wbg_new_227d7c05414eb861: function() {
        const ret = new Error();
        return ret;
      },
      __wbg_new_4f9fafbb3909af72: function() {
        const ret = new Object();
        return ret;
      },
      __wbg_new_a560378ea1240b14: function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
      },
      __wbg_new_f3c9df4f38f3f798: function() {
        const ret = new Array();
        return ret;
      },
      __wbg_new_from_slice_2580ff33d0d10520: function(arg0, arg1) {
        const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
        return ret;
      },
      __wbg_new_with_length_26bffbe236bf73f9: function(arg0) {
        const ret = new Float32Array(arg0 >>> 0);
        return ret;
      },
      __wbg_new_with_length_41a22191b9bdfd66: function(arg0) {
        const ret = new Uint32Array(arg0 >>> 0);
        return ret;
      },
      __wbg_next_01132ed6134b8ef5: function(arg0) {
        const ret = arg0.next;
        return ret;
      },
      __wbg_next_b3713ec761a9dbfd: function() {
        return handleError(function(arg0) {
          const ret = arg0.next();
          return ret;
        }, arguments);
      },
      __wbg_prototypesetcall_3e05eb9545565046: function(arg0, arg1, arg2) {
        Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
      },
      __wbg_prototypesetcall_64c287a27cc24d27: function(arg0, arg1, arg2) {
        Uint16Array.prototype.set.call(getArrayU16FromWasm0(arg0, arg1), arg2);
      },
      __wbg_prototypesetcall_e42275e601e14eeb: function(arg0, arg1, arg2) {
        Uint32Array.prototype.set.call(getArrayU32FromWasm0(arg0, arg1), arg2);
      },
      __wbg_push_6bdbc990be5ac37b: function(arg0, arg1) {
        const ret = arg0.push(arg1);
        return ret;
      },
      __wbg_set_448126769bf7c181: function(arg0, arg1, arg2) {
        arg0.set(getArrayU32FromWasm0(arg1, arg2));
      },
      __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
        arg0[arg1] = arg2;
      },
      __wbg_set_6c60b2e8ad0e9383: function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2;
      },
      __wbg_set_81b4174352e6a095: function(arg0, arg1, arg2) {
        arg0.set(arg1, arg2 >>> 0);
      },
      __wbg_set_8ee2d34facb8466e: function() {
        return handleError(function(arg0, arg1, arg2) {
          const ret = Reflect.set(arg0, arg1, arg2);
          return ret;
        }, arguments);
      },
      __wbg_set_a98c8da6557e63de: function(arg0, arg1, arg2) {
        arg0.set(getArrayF32FromWasm0(arg1, arg2));
      },
      __wbg_set_index_338a66e40fc45dee: function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2 >>> 0;
      },
      __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
      },
      __wbg_subarray_0f98d3fb634508ad: function(arg0, arg1, arg2) {
        const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
        return ret;
      },
      __wbg_subarray_517cd0f1811ab872: function(arg0, arg1, arg2) {
        const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
        return ret;
      },
      __wbg_subarray_d51e89458b3fdbf6: function(arg0, arg1, arg2) {
        const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
        return ret;
      },
      __wbg_value_7f6052747ccf940f: function(arg0) {
        const ret = arg0.value;
        return ret;
      },
      __wbindgen_cast_0000000000000001: function(arg0) {
        const ret = arg0;
        return ret;
      },
      __wbindgen_cast_0000000000000002: function(arg0, arg1) {
        const ret = getArrayF32FromWasm0(arg0, arg1);
        return ret;
      },
      __wbindgen_cast_0000000000000003: function(arg0, arg1) {
        const ret = getArrayU32FromWasm0(arg0, arg1);
        return ret;
      },
      __wbindgen_cast_0000000000000004: function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
      },
      __wbindgen_cast_0000000000000005: function(arg0) {
        const ret = BigInt.asUintN(64, arg0);
        return ret;
      },
      __wbindgen_init_externref_table: function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, void 0);
        table.set(offset + 0, void 0);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      }
    };
    return {
      __proto__: null,
      "./spark_rs_bg.js": import0
    };
  }
  const ChunkDecoderFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
  }, unregister: () => {
  } } : new FinalizationRegistry((ptr) => wasm.__wbg_chunkdecoder_free(ptr >>> 0, 1));
  const CsplatArrayFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
  }, unregister: () => {
  } } : new FinalizationRegistry((ptr) => wasm.__wbg_csplatarray_free(ptr >>> 0, 1));
  const GsplatArrayFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
  }, unregister: () => {
  } } : new FinalizationRegistry((ptr) => wasm.__wbg_gsplatarray_free(ptr >>> 0, 1));
  function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
  }
  function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
      throw new Error(`expected instance of ${klass.name}`);
    }
  }
  function debugString(val) {
    const type = typeof val;
    if (type == "number" || type == "boolean" || val == null) {
      return `${val}`;
    }
    if (type == "string") {
      return `"${val}"`;
    }
    if (type == "symbol") {
      const description = val.description;
      if (description == null) {
        return "Symbol";
      } else {
        return `Symbol(${description})`;
      }
    }
    if (type == "function") {
      const name = val.name;
      if (typeof name == "string" && name.length > 0) {
        return `Function(${name})`;
      } else {
        return "Function";
      }
    }
    if (Array.isArray(val)) {
      const length = val.length;
      let debug = "[";
      if (length > 0) {
        debug += debugString(val[0]);
      }
      for (let i = 1; i < length; i++) {
        debug += ", " + debugString(val[i]);
      }
      debug += "]";
      return debug;
    }
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
      className = builtInMatches[1];
    } else {
      return toString.call(val);
    }
    if (className == "Object") {
      try {
        return "Object(" + JSON.stringify(val) + ")";
      } catch (_) {
        return "Object";
      }
    }
    if (val instanceof Error) {
      return `${val.name}: ${val.message}
${val.stack}`;
    }
    return className;
  }
  function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
  }
  function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
  }
  function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
  }
  function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
  }
  let cachedDataViewMemory0 = null;
  function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
      cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
  }
  let cachedFloat32ArrayMemory0 = null;
  function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
      cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
  }
  function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
  }
  let cachedUint16ArrayMemory0 = null;
  function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
      cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
  }
  let cachedUint32ArrayMemory0 = null;
  function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
      cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
  }
  let cachedUint8ArrayMemory0 = null;
  function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
      cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
  }
  function handleError(f, args) {
    try {
      return f.apply(this, args);
    } catch (e) {
      const idx = addToExternrefTable0(e);
      wasm.__wbindgen_exn_store(idx);
    }
  }
  function isLikeNone(x) {
    return x === void 0 || x === null;
  }
  function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
  }
  function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
  }
  function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === void 0) {
      const buf = cachedTextEncoder.encode(arg);
      const ptr2 = malloc(buf.length, 1) >>> 0;
      getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
      WASM_VECTOR_LEN = buf.length;
      return ptr2;
    }
    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;
    const mem = getUint8ArrayMemory0();
    let offset = 0;
    for (; offset < len; offset++) {
      const code = arg.charCodeAt(offset);
      if (code > 127) break;
      mem[ptr + offset] = code;
    }
    if (offset !== len) {
      if (offset !== 0) {
        arg = arg.slice(offset);
      }
      ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
      const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
      const ret = cachedTextEncoder.encodeInto(arg, view);
      offset += ret.written;
      ptr = realloc(ptr, len, offset, 1) >>> 0;
    }
    WASM_VECTOR_LEN = offset;
    return ptr;
  }
  function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
  }
  let cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
  cachedTextDecoder.decode();
  const MAX_SAFARI_DECODE_BYTES = 2146435072;
  let numBytesDecoded = 0;
  function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
      cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
      cachedTextDecoder.decode();
      numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
  }
  const cachedTextEncoder = new TextEncoder();
  if (!("encodeInto" in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function(arg, view) {
      const buf = cachedTextEncoder.encode(arg);
      view.set(buf);
      return {
        read: arg.length,
        written: buf.length
      };
    };
  }
  let WASM_VECTOR_LEN = 0;
  let wasm;
  function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
  }
  async function __wbg_load(module, imports) {
    if (typeof Response === "function" && module instanceof Response) {
      if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
          return await WebAssembly.instantiateStreaming(module, imports);
        } catch (e) {
          const validResponse = module.ok && expectedResponseType(module.type);
          if (validResponse && module.headers.get("Content-Type") !== "application/wasm") {
            console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
          } else {
            throw e;
          }
        }
      }
      const bytes = await module.arrayBuffer();
      return await WebAssembly.instantiate(bytes, imports);
    } else {
      const instance = await WebAssembly.instantiate(module, imports);
      if (instance instanceof WebAssembly.Instance) {
        return { instance, module };
      } else {
        return instance;
      }
    }
    function expectedResponseType(type) {
      switch (type) {
        case "basic":
        case "cors":
        case "default":
          return true;
      }
      return false;
    }
  }
  async function __wbg_init(module_or_path) {
    if (wasm !== void 0) return wasm;
    if (module_or_path !== void 0) {
      if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
        ({ module_or_path } = module_or_path);
      } else {
        console.warn("using deprecated parameters for the initialization function; pass a single object instead");
      }
    }
    const imports = __wbg_get_imports();
    if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
      module_or_path = fetch(module_or_path);
    }
    const { instance } = await __wbg_load(await module_or_path, imports);
    return __wbg_finalize_init(instance);
  }
  const rpcHandlers = {
    sortSplats16,
    sortSplats32,
    loadPackedSplats,
    loadExtSplats,
    tinyLodPackedSplats,
    qualityLodPackedSplats,
    tinyLodExtSplats,
    qualityLodExtSplats,
    newLodTree,
    newSharedLodTree,
    initLodTree,
    disposeLodTree,
    updateLodTrees,
    traverseLodTrees,
    getLodTreeLevel,
    nextChunk
  };
  async function onMessage(event) {
    const {
      id,
      name,
      args
    } = event.data;
    try {
      const handler = rpcHandlers[name];
      if (!handler) {
        throw new Error(`Unknown worker RPC: ${name}`);
      }
      const sendStatus = (data) => {
        self.postMessage(
          { id, status: data },
          { transfer: getTransferable(data) }
        );
      };
      const result = await handler(args, { sendStatus });
      self.postMessage({ id, result }, { transfer: getTransferable(result) });
    } catch (error) {
      console.warn(`Worker error: ${error}`);
      self.postMessage({ id, error }, { transfer: getTransferable(error) });
    }
  }
  function sortSplats16({
    numSplats,
    readback,
    ordering
  }) {
    const activeSplats = sort_splats(numSplats, readback, ordering);
    return { activeSplats, readback, ordering };
  }
  function sortSplats32({
    numSplats,
    readback,
    ordering
  }) {
    const activeSplats = sort32_splats(numSplats, readback, ordering);
    return { activeSplats, readback, ordering };
  }
  async function decodeBytesUrl({
    decoder,
    fileBytes,
    url,
    requestHeader,
    withCredentials,
    chunked,
    chunkedLength,
    sendStatus
  }) {
    let readStream;
    let streamLength = 0;
    if (fileBytes) {
      readStream = new ReadableStream({
        start(controller) {
          controller.enqueue(fileBytes);
          controller.close();
        }
      });
      streamLength = fileBytes.length;
    } else if (url) {
      const request = new Request(url, {
        headers: requestHeader ? new Headers(requestHeader) : void 0,
        credentials: withCredentials ? "include" : "same-origin"
      });
      const response = await fetch(request);
      if (!response.ok || !response.body) {
        throw new Error(
          `Failed to fetch "${url}": ${response.status} ${response.statusText}`
        );
      }
      readStream = response.body;
      const contentLength = Number.parseInt(
        response.headers.get("Content-Length") || "0"
      );
      streamLength = Number.isNaN(contentLength) ? 0 : contentLength;
    } else if (chunked) {
      readStream = new ReadableStream({
        async start(controller) {
          async function readNext() {
            const readNextChunk = new Promise((resolve) => {
              nextChunkWaiter = resolve;
            });
            sendStatus({ nextChunk: true });
            const nextChunk2 = await readNextChunk;
            if (nextChunk2.length === 0) {
              controller.close();
              return true;
            }
            controller.enqueue(nextChunk2);
            return false;
          }
          let final;
          do {
            final = await readNext();
          } while (!final);
        }
      });
      streamLength = chunkedLength ?? 0;
    } else {
      throw new Error("No url or fileBytes provided");
    }
    const reader = readStream.getReader();
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        reader.releaseLock();
        break;
      }
      loaded += value.length;
      sendStatus({ loaded, total: streamLength });
      decoder.push(value);
    }
    const decoded = decoder.finish();
    return decoded;
  }
  function toPackedResult(packed) {
    return {
      numSplats: packed.numSplats,
      packedArray: packed.packed,
      extra: {
        sh1: packed.sh1,
        sh2: packed.sh2,
        sh3: packed.sh3,
        sh1Codes: packed.sh1Codes,
        sh2Codes: packed.sh2Codes,
        sh3Codes: packed.sh3Codes,
        lodTree: packed.lodTree
      },
      splatEncoding: packed.splatEncoding
    };
  }
  async function loadPackedSplats({
    url,
    requestHeader,
    withCredentials,
    fileBytes,
    fileType,
    pathName,
    chunked,
    chunkedLength,
    encoding,
    lod,
    lodBase,
    lodAbove,
    nonLod,
    sh1Codes,
    sh2Codes,
    sh3Codes
  }, {
    sendStatus
  }) {
    if (!lod) {
      const decoder2 = decode_to_packedsplats(
        fileType,
        pathName ?? url,
        encoding,
        sh1Codes,
        sh2Codes,
        sh3Codes
      );
      const decoded2 = await decodeBytesUrl({
        decoder: decoder2,
        fileBytes,
        url,
        requestHeader,
        withCredentials,
        chunked,
        chunkedLength,
        sendStatus
      });
      const result2 = toPackedResult(decoded2);
      if (result2.splatEncoding.lodOpacity) {
        return { lodSplats: result2 };
      }
      return result2;
    }
    const decoder = decode_to_csplatarray(fileType, pathName ?? url, encoding);
    const decoded = await decodeBytesUrl({
      decoder,
      fileBytes,
      url,
      requestHeader,
      withCredentials,
      chunked,
      chunkedLength,
      sendStatus
    });
    if (decoded.has_lod()) {
      const result2 = toPackedResult(
        decoded.to_packedsplats_lod()
      );
      return { lodSplats: result2 };
    }
    if (lodAbove !== void 0) {
      if (decoded.len() < lodAbove) {
        return toPackedResult(decoded.to_packedsplats());
      }
    }
    let result = {};
    if (nonLod) {
      result = toPackedResult(decoded.to_packedsplats());
    }
    const initialSplats = decoded.len();
    const lodName = lod === "quality" ? "Bhatt" : "Tiny";
    console.log(
      `Loaded ${initialSplats} splats. Starting ${lodName} LoD build...`
    );
    const lodStart = performance.now();
    if (lod === "quality") {
      const base = Math.max(1.1, Math.min(2, lodBase ?? 1.25));
      decoded.bhatt_lod(base);
    } else {
      const base = Math.max(1.1, Math.min(2, lodBase ?? 1.5));
      decoded.tiny_lod(base, false);
    }
    const lodDuration = performance.now() - lodStart;
    console.log(
      `${lodName} LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`
    );
    const lodPacked = decoded.to_packedsplats_lod();
    result.lodSplats = toPackedResult(lodPacked);
    return result;
  }
  function toExtResult(packed) {
    return {
      numSplats: packed.numSplats,
      extArrays: [packed.ext0, packed.ext1],
      extra: {
        sh1: packed.sh1,
        sh2: packed.sh2,
        sh3a: packed.sh3a,
        sh3b: packed.sh3b,
        sh1Codes: packed.sh1Codes,
        sh2Codes: packed.sh2Codes,
        sh3Codes: packed.sh3Codes,
        lodTree: packed.lodTree
      }
    };
  }
  async function loadExtSplats({
    url,
    requestHeader,
    withCredentials,
    fileBytes,
    fileType,
    pathName,
    chunked,
    chunkedLength,
    lod,
    lodBase,
    lodAbove,
    nonLod,
    sh1Codes,
    sh2Codes,
    sh3Codes
  }, {
    sendStatus
  }) {
    if (!lod) {
      const decoder2 = decode_to_extsplats(
        fileType,
        pathName ?? url,
        sh1Codes,
        sh2Codes,
        sh3Codes
      );
      const decoded2 = await decodeBytesUrl({
        decoder: decoder2,
        fileBytes,
        url,
        requestHeader,
        withCredentials,
        chunked,
        chunkedLength,
        sendStatus
      });
      const result2 = toExtResult(decoded2);
      if (result2.extra.lodTree) {
        return { lodSplats: result2 };
      }
      return result2;
    }
    const decoder = decode_to_gsplatarray(fileType, pathName ?? url);
    const decoded = await decodeBytesUrl({
      decoder,
      fileBytes,
      url,
      requestHeader,
      withCredentials,
      chunked,
      chunkedLength,
      sendStatus
    });
    if (decoded.has_lod()) {
      return {
        lodSplats: toExtResult(decoded.to_extsplats_lod())
      };
    }
    if (lodAbove !== void 0) {
      if (decoded.len() < lodAbove) {
        return toExtResult(decoded.to_extsplats());
      }
    }
    let result = {};
    if (nonLod) {
      result = toExtResult(decoded.to_extsplats());
    }
    const initialSplats = decoded.len();
    const lodName = lod === "quality" ? "Bhatt" : "Tiny";
    console.log(
      `Loaded ${initialSplats} splats. Starting ${lodName} LoD build...`
    );
    const lodStart = performance.now();
    if (lod === "quality") {
      const base = Math.max(1.1, Math.min(2, lodBase ?? 1.75));
      decoded.bhatt_lod(base);
    } else {
      const base = Math.max(1.1, Math.min(2, lodBase ?? 1.5));
      decoded.tiny_lod(base, false);
    }
    const lodDuration = performance.now() - lodStart;
    console.log(
      `${lodName} LoD: ${initialSplats} -> ${decoded.len()} (${lodDuration} ms)`
    );
    const lodPacked = decoded.to_extsplats_lod();
    result.lodSplats = toExtResult(lodPacked);
    return result;
  }
  async function tinyLodPackedSplats({
    numSplats,
    packedArray,
    extra,
    lodBase,
    rgba,
    encoding
  }) {
    const base = Math.max(1.1, Math.min(2, lodBase ?? 1.5));
    const lodStart = performance.now();
    const filter = false;
    const decoded = tiny_lod_packedsplats(
      numSplats,
      packedArray,
      extra,
      base,
      filter,
      rgba,
      encoding
    );
    const lodDuration = performance.now() - lodStart;
    const result = toPackedResult(decoded);
    console.log(
      `Tiny LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`
    );
    return result;
  }
  async function qualityLodPackedSplats({
    numSplats,
    packedArray,
    extra,
    lodBase,
    rgba,
    encoding
  }) {
    const base = Math.max(1.1, Math.min(2, lodBase ?? 1.75));
    const lodStart = performance.now();
    const decoded = bhatt_lod_packedsplats(
      numSplats,
      packedArray,
      extra,
      base,
      rgba,
      encoding
    );
    const lodDuration = performance.now() - lodStart;
    const result = toPackedResult(decoded);
    console.log(
      `Bhatt LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`
    );
    return result;
  }
  async function tinyLodExtSplats({
    numSplats,
    extArrays,
    extra,
    lodBase,
    rgba,
    encoding
  }) {
    const base = Math.max(1.1, Math.min(2, lodBase ?? 1.5));
    const lodStart = performance.now();
    const filter = false;
    const decoded = tiny_lod_extsplats(
      numSplats,
      extArrays[0],
      extArrays[1],
      extra,
      base,
      filter,
      rgba
    );
    const lodDuration = performance.now() - lodStart;
    const result = toExtResult(decoded);
    console.log(
      `Tiny LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`
    );
    return result;
  }
  async function qualityLodExtSplats({
    numSplats,
    extArrays,
    extra,
    lodBase,
    rgba,
    encoding
  }) {
    const base = Math.max(1.1, Math.min(2, lodBase ?? 1.75));
    const lodStart = performance.now();
    const decoded = bhatt_lod_extsplats(
      numSplats,
      extArrays[0],
      extArrays[1],
      extra,
      base,
      rgba
    );
    const lodDuration = performance.now() - lodStart;
    const result = toExtResult(decoded);
    console.log(
      `Bhatt LoD: ${numSplats} -> ${result.numSplats} (${lodDuration} ms)`
    );
    return result;
  }
  function newLodTree({
    capacity
  }) {
    const { lodId } = new_lod_tree(capacity);
    return { lodId };
  }
  function newSharedLodTree({
    lodId
  }) {
    const { lodId: newLodId } = new_shared_lod_tree(lodId);
    return { lodId: newLodId };
  }
  function initLodTree({
    numSplats,
    lodTree
  }) {
    const { lodId, chunkToPage } = init_lod_tree(numSplats, lodTree);
    return { lodId, chunkToPage };
  }
  function disposeLodTree({ lodId }) {
    dispose_lod_tree(lodId);
  }
  function updateLodTrees({
    ranges
  }) {
    const lodIds = new Uint32Array(ranges.map(({ lodId }) => lodId));
    const pageBases = new Uint32Array(ranges.map(({ pageBase }) => pageBase));
    const chunkBases = new Uint32Array(ranges.map(({ chunkBase }) => chunkBase));
    const counts = new Uint32Array(ranges.map(({ count }) => count));
    const lodTreeData = ranges.map(({ lodTreeData: lodTreeData2 }) => lodTreeData2);
    update_lod_trees(
      lodIds,
      pageBases,
      chunkBases,
      counts,
      lodTreeData
    );
  }
  function traverseLodTrees({
    maxSplats,
    pixelScaleLimit,
    lastPixelLimit,
    instances,
    traverseMode
  }) {
    const keyInstances = Object.entries(instances);
    const lodIds = new Uint32Array(
      keyInstances.map(([_key, instance]) => instance.lodId)
    );
    const rootPages = new Uint32Array(
      keyInstances.map(([_key, instance]) => instance.rootPage ?? 4294967295)
    );
    const viewToObjects = new Float32Array(
      keyInstances.flatMap(([_key, instance]) => {
        if (instance.viewToObjectCols.length !== 16) {
          throw new Error("Incorrect array size for viewToObjectCols");
        }
        return instance.viewToObjectCols;
      })
    );
    const lodScales = new Float32Array(
      keyInstances.map(([_key, instance]) => instance.lodScale)
    );
    const behindFoveates = new Float32Array(
      keyInstances.map(([_key, instance]) => instance.behindFoveate)
    );
    const coneFov0s = new Float32Array(
      keyInstances.map(([_key, instance]) => instance.coneFov0)
    );
    const coneFovs = new Float32Array(
      keyInstances.map(([_key, instance]) => instance.coneFov)
    );
    const coneFoveates = new Float32Array(
      keyInstances.map(([_key, instance]) => instance.coneFoveate)
    );
    const lodFunction = traverseMode === "dynamic" ? dynamic_traverse_lod_trees : traverse_lod_trees;
    const result = lodFunction(
      maxSplats,
      pixelScaleLimit,
      lastPixelLimit,
      lodIds,
      rootPages,
      viewToObjects,
      lodScales,
      behindFoveates,
      coneFoveates,
      coneFov0s,
      coneFovs
    );
    const { instanceIndices, chunks, pixelLimit } = result;
    const indices = keyInstances.reduce(
      (indices2, [key, _instance], index) => {
        indices2[key] = instanceIndices[index];
        return indices2;
      },
      {}
    );
    return {
      keyIndices: indices,
      chunks,
      pixelLimit
    };
  }
  function getLodTreeLevel({
    lodId,
    level
  }) {
    return get_lod_tree_level(lodId, level);
  }
  let nextChunkWaiter = (_chunk) => {
  };
  async function nextChunk({ chunk }) {
    nextChunkWaiter(chunk);
  }
  function getTransferable(ctx) {
    const buffers = [];
    const seen = /* @__PURE__ */ new Set();
    function traverse(obj) {
      if (obj && typeof obj === "object" && !seen.has(obj)) {
        seen.add(obj);
        if (obj instanceof ArrayBuffer) {
          buffers.push(obj);
        } else if (ArrayBuffer.isView(obj)) {
          buffers.push(obj.buffer);
        } else if (Array.isArray(obj)) {
          obj.forEach(traverse);
        } else {
          Object.values(obj).forEach(traverse);
        }
      }
    }
    traverse(ctx);
    return buffers;
  }
  async function initialize() {
    let resolveWaitForModule;
    const waitForModule = new Promise((resolve) => {
      resolveWaitForModule = resolve;
    });
    const pending = [];
    const bufferMessage = (event) => {
      if (event.data.name === "init-wasm") {
        resolveWaitForModule(event.data.module);
        return;
      }
      pending.push(event);
    };
    self.addEventListener("message", bufferMessage);
    await __wbg_init({ module_or_path: await waitForModule });
    self.removeEventListener("message", bufferMessage);
    self.addEventListener("message", onMessage);
    for (const event of pending) {
      onMessage(event);
    }
    pending.length = 0;
  }
  initialize().catch(console.error);
})();
//# sourceMappingURL=worker-D4QoimE1.js.map
